"""Minimal agent trace reconstructed from existing events."""

from __future__ import annotations

import pytest

from app.core.harness.mcp_hub import ToolDef, mcp_hub
from app.core.runtime.read_ports.events import reconstruct_execution_trace


@pytest.mark.asyncio
async def test_reconstruct_trace_after_success_and_failure(isolated_kernel):
    k, _ = isolated_kernel
    cid = "trace_mixed"

    await k.invoke_capability(
        "get_current_time", {}, actor="user", correlation_id=cid,
    )

    def boom() -> str:
        raise RuntimeError("nope")

    mcp_hub.register_tool(ToolDef(
        name="trace_boom",
        description="x",
        parameters={"type": "object", "properties": {}},
        handler=boom,
    ))
    try:
        await k.invoke_capability("trace_boom", {}, actor="user", correlation_id=cid)
    finally:
        mcp_hub.unregister_tool("trace_boom")

    k.emit_event(
        "ChatRequested", "chat", "chat_1",
        payload={"user_message": "what time is it", "conversation_id": "c1"},
        actor="user",
        correlation_id=cid,
    )
    k.emit_event(
        "ChatCompleted", "chat", "chat_1",
        payload={
            "status": "ok",
            "content": "done",
            "fragment_ids": ["core.background"],
            "intent_tags": ["planning"],
        },
        actor="system",
        correlation_id=cid,
    )

    trace = reconstruct_execution_trace(cid)
    assert trace["correlation_id"] == cid
    assert trace["user_request"] == "what time is it"
    assert trace["context"]["fragment_ids"] == ["core.background"]
    names = [t["name"] for t in trace["tools"]]
    assert "get_current_time" in names
    assert "trace_boom" in names
    boom_row = next(t for t in trace["tools"] if t["name"] == "trace_boom")
    assert boom_row["success"] is False
    assert boom_row["outcome"] == "tool_execution_failure"
    time_row = next(t for t in trace["tools"] if t["name"] == "get_current_time")
    assert time_row["success"] is True
    assert trace["final_result"]["content"] == "done"
    assert trace["events"]


@pytest.mark.asyncio
async def test_reconstruct_deferred_approval_is_not_tool_failure(isolated_kernel):
    k, _ = isolated_kernel
    cid = "trace_defer"
    k.emit_event(
        "CapabilityDenied", "capability", "cap_write_file",
        payload={
            "name": "write_file",
            "reason": "deferred",
            "approval_id": "apr_1",
        },
        actor="user",
        correlation_id=cid,
    )
    k.emit_event(
        "CapabilityDenied", "capability", "cap_shell_exec",
        payload={"name": "shell_exec", "reason": "forbidden_by_policy"},
        actor="user",
        correlation_id=cid,
    )
    trace = reconstruct_execution_trace(cid)
    deferred = next(t for t in trace["tools"] if t["name"] == "write_file")
    denied = next(t for t in trace["tools"] if t["name"] == "shell_exec")
    assert deferred["success"] is False
    assert deferred["outcome"] == "approval_required"
    assert denied["outcome"] == "authorization_failure"
