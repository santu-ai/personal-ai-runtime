"""Keyless recorded-session replay: scripted model, real Brain + Kernel."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.agents.conversation import ConversationManager
from tests.recorded_sessions.harness import FIXTURES_DIR, load_fixture, replay_fixture


def _fixtures() -> list[Path]:
    return sorted(FIXTURES_DIR.glob("*.json"))


@pytest.mark.asyncio
@pytest.mark.parametrize("fixture_path", _fixtures(), ids=lambda p: p.stem)
async def test_recorded_session(fixture_path, isolated_kernel, allow_tmp_fs, monkeypatch):
    k, db = isolated_kernel
    workspace = allow_tmp_fs / "rs-ws"
    workspace.mkdir()
    fixture = load_fixture(fixture_path, workspace)
    result = await replay_fixture(
        fixture, kernel=k, db=db, workspace=workspace, monkeypatch=monkeypatch,
    )
    expect = fixture.get("expect") or {}
    _assert_expect(k, result, expect)


def _assert_expect(kernel, result, expect: dict) -> None:
    mgr = ConversationManager(conversation_id=result.conv_id, kernel=kernel)
    recorded = mgr.load_recorded_messages()
    roles = [m["role"] for m in recorded]

    if expect.get("message_roles"):
        assert roles == expect["message_roles"], roles

    for needle in expect.get("final_text_contains") or []:
        assert needle in result.text, result.text

    if "confirmation_required" in expect:
        pending = result.confirmation is not None
        assert pending is bool(expect["confirmation_required"])
        if pending and expect.get("tool_name"):
            assert result.confirmation is not None
            assert result.confirmation.get("tool_name") == expect["tool_name"]

    if expect.get("tools") or expect.get("capability_invoked"):
        from app.core.runtime.read_ports.events import reconstruct_execution_trace

        trace = reconstruct_execution_trace(result.correlation_id)
        names = [t.get("name") for t in trace.get("tools") or []]
        invoked = [
            t.get("name")
            for t in trace.get("tools") or []
            if t.get("event") == "CapabilityInvoked"
        ]
        for name in expect.get("tools") or []:
            assert name in names, names
        for name in expect.get("capability_invoked") or []:
            assert name in invoked, names

    for needle in expect.get("tool_result_contains") or []:
        tool_msgs = [m for m in recorded if m["role"] == "tool"]
        blob = "\n".join(str(m.get("content") or "") for m in tool_msgs)
        assert needle in blob, blob

    for rel, content in (expect.get("file_contains") or {}).items():
        path = result.workspace / rel
        assert path.is_file(), path
        assert content in path.read_text(encoding="utf-8")

    for rel in expect.get("file_absent") or []:
        assert not (result.workspace / rel).exists()
