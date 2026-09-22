"""ask_user grant carries the text answer; cancel persists a denied result."""

import json
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


def _pending_ask(kernel, *, correlation_id: str, question: str = "简报要覆盖最近几天？"):
    return kernel.request_approval(
        "ask_user",
        risk="high",
        ctx={"args": {"question": question}},
        actor="user",
        correlation_id=correlation_id,
    )


def test_ask_user_grant_resumes_with_answer(client: TestClient, monkeypatch):
    from app.core.agents.conversation import ConversationAPI
    from app.core.runtime import read_ports
    from app.core.runtime.kernel_instance import kernel
    from app.core.runtime.plan_resume import load_chat_checkpoint, record_chat_checkpoint

    correlation_id = "ask-grant"
    conv_id = ConversationAPI.create("ask grant")["id"]
    pending = _pending_ask(kernel, correlation_id=correlation_id)
    approval_id = pending["approval_id"]
    record_chat_checkpoint(
        correlation_id,
        {
            "conversation_id": conv_id,
            "user_message": "做简报",
            "messages": [{"role": "user", "content": "做简报"}],
            "iteration": 0,
            "status": "awaiting_approval",
            "pending_tool_call_ids": ["tc_ask"],
        },
        kernel=kernel,
    )
    resume = AsyncMock(return_value={
        "assistant_message": "按最近三天继续",
        "pending": False,
        "tool_results": [],
        "error": "",
    })
    # brain_chat_stream binds kernel at import; the test app resets the singleton.
    monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", kernel)
    monkeypatch.setattr("app.core.agents.brain_chat_stream.resume_after_approved_tool", resume)
    invoke = AsyncMock(side_effect=AssertionError("ask_user must not invoke a capability"))
    monkeypatch.setattr(kernel, "invoke_capability", invoke)

    response = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json={
            "decision": "approve",
            "conv_id": conv_id,
            "tool_call_id": "tc_ask",
            "answer": "  最近三天  ",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["assistant_message"] == "按最近三天继续"
    invoke.assert_not_awaited()
    resume.assert_awaited()

    approval = read_ports.query_approval(approval_id)
    assert approval is not None
    assert approval["status"] == "approved"

    msgs = client.get(f"/api/chat/conversations/{conv_id}/messages").json()
    tools = [m for m in msgs if m.get("role") == "tool"]
    assert len(tools) == 1
    payload = json.loads(tools[0]["content"])
    assert payload["status"] == "answered"
    assert payload["answer"] == "最近三天"
    assert payload["question"] == "简报要覆盖最近几天？"

    ckpt = load_chat_checkpoint(correlation_id, kernel=kernel)
    assert ckpt is not None
    assert any(m.get("role") == "tool" and "最近三天" in str(m.get("content")) for m in ckpt["messages"])
    assert ckpt.get("resume_after_approval") is True


def test_ask_user_deny_persists_cancel_and_clears_checkpoint(client: TestClient, monkeypatch):
    from app.core.agents.conversation import ConversationAPI
    from app.core.runtime import read_ports
    from app.core.runtime.kernel_instance import kernel
    from app.core.runtime.plan_resume import load_chat_checkpoint, record_chat_checkpoint

    correlation_id = "ask-deny"
    conv_id = ConversationAPI.create("ask deny")["id"]
    pending = _pending_ask(kernel, correlation_id=correlation_id, question="用哪份资料？")
    record_chat_checkpoint(
        correlation_id,
        {"status": "awaiting_approval", "messages": [], "pending_tool_call_ids": ["tc_ask"]},
        kernel=kernel,
    )
    resume = AsyncMock(side_effect=AssertionError("cancel must not call the model"))
    monkeypatch.setattr("app.core.agents.brain_chat_stream.resume_after_approved_tool", resume)

    response = client.post(
        f"/api/chat/approvals/{pending['approval_id']}/resolve",
        json={"decision": "deny", "conv_id": conv_id, "tool_call_id": "tc_ask"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "denied"
    assert "已取消澄清" in (body.get("assistant_message") or "")
    assert "用哪份资料？" in (body.get("assistant_message") or "")
    resume.assert_not_awaited()
    assert load_chat_checkpoint(correlation_id, kernel=kernel) is None

    approval = read_ports.query_approval(pending["approval_id"])
    assert approval is not None
    assert approval["status"] == "denied"

    msgs = client.get(f"/api/chat/conversations/{conv_id}/messages").json()
    tools = [m for m in msgs if m.get("role") == "tool"]
    assert len(tools) == 1
    payload = json.loads(tools[0]["content"])
    assert payload["status"] == "denied"
    assert payload["reason"] == "user_cancelled"
    assert payload["question"] == "用哪份资料？"
    notes = [m for m in msgs if m.get("role") == "assistant" and "已取消澄清" in (m.get("content") or "")]
    assert len(notes) == 1


def test_ask_user_empty_answer_stays_pending(client: TestClient):
    from app.core.runtime import read_ports
    from app.core.runtime.kernel_instance import kernel

    pending = _pending_ask(kernel, correlation_id="ask-empty")
    response = client.post(
        f"/api/chat/approvals/{pending['approval_id']}/resolve",
        json={"decision": "approve", "answer": "   ", "conv_id": "c", "tool_call_id": "t"},
    )
    assert response.status_code == 422
    approval = read_ports.query_approval(pending["approval_id"])
    assert approval is not None
    assert approval["status"] == "pending"


def test_bare_approve_rejects_ask_user(client: TestClient):
    from app.core.runtime import read_ports
    from app.core.runtime.kernel_instance import kernel

    pending = _pending_ask(kernel, correlation_id="ask-bare")
    response = client.post(f"/api/approvals/{pending['approval_id']}/approve")
    assert response.status_code == 400
    approval = read_ports.query_approval(pending["approval_id"])
    assert approval is not None
    assert approval["status"] == "pending"
