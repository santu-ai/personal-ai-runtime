"""Capability execution truth: handler failure must not be recorded as success."""

from __future__ import annotations

import asyncio

import pytest

from app.core.harness.builtin_tools.filesystem import filesystem_server
from app.core.harness.mcp_hub import ToolDef, mcp_hub


@pytest.fixture
def kernel(isolated_kernel):
    k, _db = isolated_kernel
    return k


def _register(name: str, handler, *, is_async: bool = False) -> None:
    mcp_hub.register_tool(ToolDef(
        name=name,
        description="eval/truth tool",
        parameters={"type": "object", "properties": {}},
        handler=handler,
        is_async=is_async,
    ))


@pytest.mark.asyncio
async def test_handler_exception_is_capability_failed(kernel):
    def boom() -> str:
        raise RuntimeError("disk full")

    _register("truth_boom", boom)
    try:
        result = await kernel.invoke_capability(
            "truth_boom", {}, actor="user", correlation_id="truth_boom",
        )
    finally:
        mcp_hub.unregister_tool("truth_boom")

    assert result["status"] == "error"
    assert result["outcome"] == "tool_execution_failure"
    assert "disk full" in result["error"]

    events = kernel.read_events(correlation_id="truth_boom")
    types = [e.type for e in events]
    assert "CapabilityFailed" in types
    assert "CapabilityInvoked" not in types
    failed = next(e for e in events if e.type == "CapabilityFailed")
    assert failed.payload.get("outcome") == "tool_execution_failure"
    rows = kernel.query_state("tool_calls", tool_name="truth_boom")
    assert rows
    assert int(rows[-1]["success"]) == 0


@pytest.mark.asyncio
async def test_unknown_tool_is_capability_failed(kernel):
    result = await kernel.invoke_capability(
        "definitely_missing_tool_xyz", {}, actor="user", correlation_id="truth_missing",
    )
    assert result["status"] == "error"
    assert result["outcome"] == "tool_not_found"
    events = kernel.read_events(correlation_id="truth_missing")
    assert any(e.type == "CapabilityFailed" for e in events)
    assert not any(e.type == "CapabilityInvoked" for e in events)


@pytest.mark.asyncio
async def test_async_timeout_is_capability_failed(kernel, monkeypatch):
    async def slow() -> str:
        await asyncio.sleep(5)
        return "late"

    monkeypatch.setattr("app.config.settings.tool_timeout_seconds", 0.05)
    _register("truth_slow", slow, is_async=True)
    try:
        result = await kernel.invoke_capability(
            "truth_slow", {}, actor="user", correlation_id="truth_slow",
        )
    finally:
        mcp_hub.unregister_tool("truth_slow")

    assert result["status"] == "error"
    assert result["outcome"] == "tool_timeout"
    events = kernel.read_events(correlation_id="truth_slow")
    assert any(e.type == "CapabilityFailed" for e in events)
    assert not any(e.type == "CapabilityInvoked" for e in events)


@pytest.mark.asyncio
async def test_missing_file_is_capability_failed_not_invoked(kernel, tmp_path):
    """Builtin JSON-style errors must not be recorded as CapabilityInvoked."""
    old = list(filesystem_server.allowed_dirs)
    filesystem_server.allowed_dirs = old + [str(tmp_path.resolve())]
    missing = tmp_path / "does-not-exist.txt"
    try:
        result = await kernel.invoke_capability(
            "read_file",
            {"path": str(missing)},
            actor="user",
            correlation_id="truth_missing_file",
        )
    finally:
        filesystem_server.allowed_dirs = old

    assert result["status"] == "error"
    assert result["outcome"] == "tool_execution_failure"
    assert "File not found" in result["error"]
    events = kernel.read_events(correlation_id="truth_missing_file")
    assert any(e.type == "CapabilityFailed" for e in events)
    assert not any(e.type == "CapabilityInvoked" for e in events)


@pytest.mark.asyncio
async def test_invalid_calendar_name_is_capability_failed(kernel):
    result = await kernel.invoke_capability(
        "list_calendar_events",
        {"calendar": "../etc"},
        actor="user",
        correlation_id="truth_bad_cal",
    )
    assert result["status"] == "error"
    assert result["outcome"] == "tool_invalid_result"
    events = kernel.read_events(correlation_id="truth_bad_cal")
    assert any(e.type == "CapabilityFailed" for e in events)
    assert not any(e.type == "CapabilityInvoked" for e in events)


@pytest.mark.asyncio
async def test_nonpositive_timer_is_capability_failed(kernel):
    result = await kernel.invoke_capability(
        "set_timer",
        {"minutes": 0, "hours": 0, "message": "noop"},
        actor="user",
        correlation_id="truth_bad_timer",
    )
    assert result["status"] == "error"
    assert result["outcome"] == "tool_invalid_result"
    events = kernel.read_events(correlation_id="truth_bad_timer")
    assert any(e.type == "CapabilityFailed" for e in events)
    assert not any(e.type == "CapabilityInvoked" for e in events)


def test_delete_missing_goal_raises_not_json_success(isolated_kernel):
    from app.core.harness.builtin_tools.goals import _writer_delete_goal
    from app.core.harness.mcp_hub import ToolInvokeError

    with pytest.raises(ToolInvokeError, match="未找到目标"):
        _writer_delete_goal("does-not-exist")


@pytest.mark.asyncio
async def test_read_inbox_email_imap_failure_is_capability_failed(kernel, monkeypatch):
    from app.core.harness.builtin_tools.email import EmailFetchError, email_server

    def boom(_mid: str):
        raise EmailFetchError("IMAP login failed")

    monkeypatch.setattr(email_server, "read_email_body", boom)
    result = await kernel.invoke_capability(
        "read_inbox_email",
        {"message_id": "<missing@example.com>"},
        actor="user",
        correlation_id="truth_mid_imap",
    )
    assert result["status"] == "error"
    assert result["outcome"] == "tool_execution_failure"
    events = kernel.read_events(correlation_id="truth_mid_imap")
    assert any(e.type == "CapabilityFailed" for e in events)
    assert not any(e.type == "CapabilityInvoked" for e in events)
