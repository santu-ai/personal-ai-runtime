"""Inbox email summary — 正文必须经 Kernel 治理面（invoke_capability）获取。"""

from __future__ import annotations

import json

import pytest

from app.api.inbox import get_inbox_email_summary


def _fake_row(email_id: str) -> dict:
    return {
        "id": email_id,
        "sender": "alice@example.com",
        "subject": "Hello",
        "preview": "preview text",
    }


@pytest.mark.asyncio
async def test_summary_body_goes_through_kernel_capability(monkeypatch):
    calls: list[dict] = []

    class FakeKernel:
        async def invoke_capability(self, name, args=None, **kwargs):
            calls.append({"name": name, "args": args, **kwargs})
            return {
                "status": "success",
                "result": json.dumps(
                    {"message_id": "<m1@x>", "body": "全文正文内容"},
                    ensure_ascii=False,
                ),
            }

    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", FakeKernel())
    monkeypatch.setattr(
        "app.core.runtime.read_ports.inbox.query_inbox_email",
        lambda email_id: _fake_row(email_id),
    )

    captured: dict = {}

    async def fake_complete(messages, **kwargs):
        captured["messages"] = messages
        return "这是摘要", "provider"

    monkeypatch.setattr(
        "app.core.agents.brain_llm_ops.complete_text_with_failover",
        fake_complete,
    )

    resp = await get_inbox_email_summary("<m1@x>")
    assert resp["summary"] == "这是摘要"
    assert len(calls) == 1
    assert calls[0]["name"] == "read_inbox_email"
    assert calls[0]["args"] == {"message_id": "<m1@x>"}
    assert calls[0]["actor"] == "user"
    assert calls[0]["correlation_id"].startswith("inbox_summary_")
    # LLM 收到的是治理面取到的全文正文，而非 preview。
    assert "全文正文内容" in captured["messages"][0]["content"]


@pytest.mark.asyncio
async def test_summary_falls_back_to_preview_on_capability_failure(monkeypatch):
    class FakeKernel:
        async def invoke_capability(self, name, args=None, **kwargs):
            del name, args, kwargs
            return {"status": "error", "error": "imap down"}

    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", FakeKernel())
    monkeypatch.setattr(
        "app.core.runtime.read_ports.inbox.query_inbox_email",
        lambda email_id: _fake_row(email_id),
    )

    captured: dict = {}

    async def fake_complete(messages, **kwargs):
        captured["messages"] = messages
        return "摘要", "provider"

    monkeypatch.setattr(
        "app.core.agents.brain_llm_ops.complete_text_with_failover",
        fake_complete,
    )

    resp = await get_inbox_email_summary("<m2@x>")
    assert resp["summary"] == "摘要"
    # 正文取不到时回退到轮询期存下的 preview。
    assert "preview text" in captured["messages"][0]["content"]
