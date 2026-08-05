"""Regression test for goal write capability gate.

Goal writes must go through ``kernel.invoke_capability`` so
``requires_confirmation=True`` is enforceable. Writers registered on
``mcp_hub`` run only after the gate allows.
"""

import json

import pytest

from app.core.harness.mcp_hub import mcp_hub


def test_goals_tools_are_registered_with_writer_handlers():
    """The 3 goal-write tools must be registered with the writer functions."""
    for name in ("create_goal", "update_goal_progress", "complete_goal"):
        tool = mcp_hub.get_tool(name)
        assert tool is not None, f"{name} must be registered"
        handler_name = getattr(tool.handler, "__name__", "")
        assert handler_name.startswith("_writer_"), (
            f"{name} handler must be a _writer_* function (got {handler_name}); "
            "otherwise invoke_capability would not reach the actual emit."
        )


@pytest.mark.asyncio
async def test_create_goal_emits_capability_invoked(isolated_kernel):
    """create_goal via invoke_capability must enter the 3-gate.

    Auto-allow is impossible (the policy marks it needs_user), so without
    pre-approval the gate defers and we see CapabilityDenied (deferred).
    """
    k, _db = isolated_kernel
    await k.invoke_capability(
        "create_goal",
        args={"title": "ship release", "importance": 0.9},
        actor="user",
    )

    cap_events = [
        e for e in k.read_events()
        if e.type in {"CapabilityInvoked", "CapabilityDenied"}
    ]
    assert len(cap_events) >= 1, (
        "create_goal did not produce a Capability* event — the 3-gate was "
        "bypassed."
    )
    work_events = [
        e for e in k.read_events()
        if e.type.startswith("WorkItem")
    ]
    assert work_events == [], (
        "WorkItem event emitted before the gate allowed — direct emit path "
        "regression."
    )


def test_writer_create_goal_emits_work_item(isolated_kernel):
    """The writer handler emits WorkItemCreated when invoked directly."""
    k, _db = isolated_kernel
    from app.core.harness.builtin_tools.goals import _writer_create_goal

    result_json = _writer_create_goal(title="writer goal", importance=0.8)
    result = json.loads(result_json)
    assert result["status"] == "created"

    events = k.read_events()
    types = [e.type for e in events]
    assert "WorkItemCreated" in types
    work_event = next(e for e in events if e.type == "WorkItemCreated")
    assert work_event.payload["work_type"] == "goal"
    assert work_event.payload["title"] == "writer goal"
    assert work_event.payload["importance"] == 0.8
