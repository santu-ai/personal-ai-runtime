"""Live Gmail IMAP read via Kernel — opt-in, never sends mail."""

from __future__ import annotations

import os

import pytest

from tests.eval.harness import EvalClock, EvalRecord

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_EMAIL", "").strip() not in {"1", "true", "yes"},
        reason="Set RUN_LIVE_EMAIL=1 to enable live IMAP eval",
    ),
]


@pytest.mark.asyncio
async def test_live_gmail_check_inbox_no_send(isolated_kernel, monkeypatch):
    user = (os.environ.get("EMAIL_USER") or "").strip()
    password = (os.environ.get("EMAIL_PASS") or "").replace(" ", "")
    if not user or not password:
        pytest.skip("EMAIL_USER / EMAIL_PASS not set")

    monkeypatch.setenv("EMAIL_USER", user)
    monkeypatch.setenv("EMAIL_PASS", password)
    monkeypatch.setenv("EMAIL_IMAP_HOST", os.environ.get("EMAIL_IMAP_HOST", "imap.gmail.com"))

    from app.core.harness.builtin_tools.email import EmailServer, email_server

    email_server._refresh_config(force=True)

    k, _db = isolated_kernel
    clock = EvalClock()
    # Direct server first so Kernel governance is not required for a read probe.
    server = EmailServer()
    try:
        raw = server.check_inbox(limit=5, unread_only=False)
    except Exception as exc:
        rec = EvalRecord(
            task_id="live_gmail_inbox",
            input=user,
            expected_behavior="IMAP login and list succeed (no send)",
            actual_behavior=type(exc).__name__,
            success=False,
            failure_reason=str(exc)[:200],
            duration_s=clock.elapsed(),
            notes="Did not send mail.",
        )
        assert rec.success, rec.as_dict()
        return

    cap = await k.invoke_capability(
        "check_inbox",
        {"unread_only": False, "limit": 5},
        actor="user",
        correlation_id="live-gmail",
    )
    rec = EvalRecord(
        task_id="live_gmail_inbox",
        input=user,
        expected_behavior="check_inbox status success; no send_email",
        actual_behavior=str(cap.get("status")),
        success=cap.get("status") == "success" and bool(raw),
        failure_reason=cap.get("error"),
        tool_calls=["check_inbox"],
        duration_s=clock.elapsed(),
        trace_id="live-gmail",
        notes="Body omitted. Did not send mail.",
    )
    assert rec.success, rec.as_dict()
    events = k.read_events(correlation_id="live-gmail")
    assert not any(
        (e.payload or {}).get("name") == "send_email" for e in events
    )
