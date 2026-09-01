"""HTTP resolve_approval must execute the governed approval record."""

import json
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient


def _pending_write_file(kernel):
    """Create a pending write_file approval without crossing event loops."""
    return kernel.request_approval(
        "write_file",
        risk="high",
        ctx={"args": {"path": "/tmp/safe.txt", "content": "hello"}},
        actor="user",
        correlation_id="approval-resolve-test",
    )


def test_resolve_rejects_tampered_tool_name(client: TestClient):
    from app.core.runtime.kernel_instance import kernel

    pending = _pending_write_file(kernel)
    assert pending["status"] == "pending"
    approval_id = pending["approval_id"]

    r = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json={
            "decision": "approve",
            "tool_name": "shell_exec",
            "tool_args": {"command": "echo pwned"},
            "conv_id": "",
            "tool_call_id": "",
        },
    )
    assert r.status_code == 400
    assert "match" in r.json()["detail"].lower()


def test_resolve_rejects_already_resolved(client: TestClient):
    from app.core.runtime.kernel_instance import kernel

    pending = _pending_write_file(kernel)
    approval_id = pending["approval_id"]

    r1 = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json={"decision": "deny", "conv_id": "", "tool_call_id": ""},
    )
    assert r1.status_code == 200

    r2 = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json={"decision": "approve", "conv_id": "", "tool_call_id": ""},
    )
    assert r2.status_code == 409


def test_resolve_deny_persists_tool_result_and_note(client: TestClient):
    """Deny must close the tool turn in the conversation without calling the LLM."""
    from app.core.agents.conversation import ConversationAPI, ConversationManager
    from app.core.runtime.kernel_instance import kernel

    conv = ConversationAPI.create("deny persist")
    conv_id = conv["id"]
    ConversationManager(conversation_id=conv_id).save_assistant_message(
        "I'll write a file",
        tool_calls=[{"id": "tc_deny_1", "function": {"name": "write_file", "arguments": "{}"}}],
    )
    pending = _pending_write_file(kernel)
    approval_id = pending["approval_id"]

    r = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json={
            "decision": "deny",
            "conv_id": conv_id,
            "tool_call_id": "tc_deny_1",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "denied"
    assert "已拒绝" in (body.get("assistant_message") or "")
    assert "write_file" in (body.get("assistant_message") or "")

    msgs = client.get(f"/api/chat/conversations/{conv_id}/messages").json()
    tools = [m for m in msgs if m.get("role") == "tool"]
    assert len(tools) == 1
    assert tools[0].get("tool_call_id") == "tc_deny_1"
    assert "denied" in (tools[0].get("content") or "")
    notes = [
        m for m in msgs
        if m.get("role") == "assistant" and "已拒绝" in (m.get("content") or "")
    ]
    assert len(notes) == 1


def test_resolve_executes_server_record(client: TestClient, monkeypatch):
    from app.core.harness.mcp_hub import mcp_hub
    from app.core.runtime.kernel_instance import kernel

    captured: dict = {}

    async def fake_invoke(name, args):
        captured["name"] = name
        captured["args"] = args
        return json.dumps({"ok": True})

    monkeypatch.setattr(mcp_hub, "invoke_tool", fake_invoke)

    pending = _pending_write_file(kernel)
    approval_id = pending["approval_id"]

    r = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json={"decision": "approve", "conv_id": "", "tool_call_id": ""},
    )
    assert r.status_code == 200
    assert captured["name"] == "write_file"
    assert captured["args"] == {"path": "/tmp/safe.txt", "content": "hello"}


def test_resolve_missing_decision_returns_422(client: TestClient):
    from app.core.runtime.kernel_instance import kernel

    pending = _pending_write_file(kernel)
    r = client.post(
        f"/api/chat/approvals/{pending['approval_id']}/resolve",
        json={"conv_id": "", "tool_call_id": ""},
    )
    assert r.status_code == 422


def test_approved_checkpoint_allows_resume_only_retry(
    client: TestClient, monkeypatch,
):
    """A failed post-tool LLM call retries reasoning, never the capability."""
    from app.core.agents.conversation import ConversationAPI
    from app.core.runtime.kernel_instance import kernel
    from app.core.runtime.plan_resume import record_chat_checkpoint

    correlation_id = "approval-resume-only"
    conv_id = ConversationAPI.create("resume only")["id"]
    pending = kernel.request_approval(
        "write_file",
        risk="high",
        ctx={"args": {"path": "/tmp/safe.txt", "content": "hello"}},
        actor="user",
        correlation_id=correlation_id,
    )
    approval_id = pending["approval_id"]
    kernel.grant_approval(
        approval_id,
        action="write_file",
        actor="user",
        correlation_id=correlation_id,
    )
    record_chat_checkpoint(
        correlation_id,
        {
            "status": "in_progress",
            "resume_after_approval": True,
            "messages": [{"role": "tool", "tool_call_id": "tc_retry", "content": "ok"}],
            "iteration": 1,
            "user_message": "write it",
        },
        kernel=kernel,
    )

    resume = AsyncMock(side_effect=[
        {
            "assistant_message": "",
            "pending": False,
            "tool_results": [],
            "error": "llm down",
        },
        {
            "assistant_message": "恢复完成",
            "pending": False,
            "tool_results": [],
            "error": "",
        },
    ])
    monkeypatch.setattr(
        "app.core.agents.brain_chat_stream.resume_after_approved_tool",
        resume,
    )
    invoke = AsyncMock(side_effect=AssertionError("capability must not run again"))
    monkeypatch.setattr(kernel, "invoke_capability", invoke)

    payload = {
        "decision": "approve",
        "conv_id": conv_id,
        "tool_call_id": "tc_retry",
    }
    first = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json=payload,
    )
    assert first.status_code == 200
    assert first.json()["status"] == "resume_failed"
    assert first.json()["retryable"] is True

    second = client.post(
        f"/api/chat/approvals/{approval_id}/resolve",
        json=payload,
    )
    assert second.status_code == 200
    assert second.json()["assistant_message"] == "恢复完成"
    assert resume.await_count == 2
    invoke.assert_not_awaited()


def test_deny_clears_checkpoint_without_conversation_payload(client: TestClient):
    from app.core.runtime.kernel_instance import kernel
    from app.core.runtime.plan_resume import (
        load_chat_checkpoint,
        record_chat_checkpoint,
    )

    correlation_id = "approval-deny-clear"
    pending = kernel.request_approval(
        "write_file",
        risk="high",
        ctx={"args": {"path": "/tmp/safe.txt", "content": "hello"}},
        actor="user",
        correlation_id=correlation_id,
    )
    record_chat_checkpoint(
        correlation_id,
        {"status": "awaiting_approval", "messages": [], "iteration": 0},
        kernel=kernel,
    )

    response = client.post(
        f"/api/chat/approvals/{pending['approval_id']}/resolve",
        json={"decision": "deny", "conv_id": "", "tool_call_id": ""},
    )

    assert response.status_code == 200
    assert load_chat_checkpoint(correlation_id, kernel=kernel) is None
