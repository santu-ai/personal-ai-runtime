"""Kernel-level approval flow (pending → pre_approved / grant / deny).

Not an HTTP integration test — lives under tests/runtime.
"""

import pytest


@pytest.mark.asyncio
async def test_high_risk_capability_pending_then_approve(isolated_kernel, allow_tmp_fs):
    k, _db = isolated_kernel
    target = allow_tmp_fs / "x.txt"
    args = {"path": str(target), "content": "hi"}
    cap = await k.invoke_capability("write_file", args, actor="user")
    assert cap["status"] == "pending"
    approval_id = cap["approval_id"]

    cap2 = await k.invoke_capability(
        "write_file",
        args,
        actor="user",
        correlation_id="retry",
        pre_approved=True,
        approval_id=approval_id,
    )
    assert cap2["status"] == "success"
    assert target.read_text(encoding="utf-8") == "hi"


@pytest.mark.asyncio
async def test_apply_patch_pending_then_approve(isolated_kernel, allow_tmp_fs):
    k, _db = isolated_kernel
    target = allow_tmp_fs / "app.py"
    target.write_text("a", encoding="utf-8")
    args = {"path": str(target), "old_string": "a", "new_string": "b"}
    cap = await k.invoke_capability("apply_patch", args, actor="user")
    assert cap["status"] == "pending"
    approval_id = cap["approval_id"]

    cap2 = await k.invoke_capability(
        "apply_patch",
        args,
        actor="user",
        correlation_id="patch-retry",
        pre_approved=True,
        approval_id=approval_id,
    )
    assert cap2["status"] == "success"
    assert target.read_text(encoding="utf-8") == "b"


def test_request_approval_via_kernel(isolated_kernel):
    k, _db = isolated_kernel
    result = k.request_approval(
        action="write_file",
        risk="high",
        ctx={"args": {"path": "/tmp/test"}, "proposed_by": "agent:planner"},
        actor="agent:planner",
    )
    assert result is not None
    assert result["status"] == "pending"


def test_approve_lifecycle_via_kernel(isolated_kernel):
    k, _db = isolated_kernel
    result = k.request_approval(
        action="read_file",
        risk="high",
        ctx={"args": {"path": "/tmp/read"}, "proposed_by": "agent:planner"},
        actor="agent:planner",
    )
    k.grant_approval(
        result["approval_id"], action="read_file", actor="user", reason="test",
    )
    approval = k.query_state("approvals", id=result["approval_id"])
    assert len(approval) == 1
    assert approval[0]["status"] == "approved"


def test_reject_approval_via_kernel(isolated_kernel):
    k, _db = isolated_kernel
    result = k.request_approval(
        action="shell_exec",
        risk="high",
        ctx={"args": {"command": "ls"}, "proposed_by": "agent:planner"},
        actor="agent:planner",
    )
    k.deny_approval(
        result["approval_id"], action="shell_exec", actor="user",
        reason="test reject",
    )
    approval = k.query_state("approvals", id=result["approval_id"])
    assert len(approval) == 1
    assert approval[0]["status"] in ("rejected", "denied")


def test_get_approval_missing(isolated_kernel):
    from app.core.runtime.capability_governance import CapabilityGovernance

    k, _db = isolated_kernel
    assert CapabilityGovernance.get_approval(k, "nonexistent") is None


def test_request_approval_with_task_id_via_kernel(isolated_kernel):
    k, _db = isolated_kernel
    result = k.request_approval(
        action="apply_patch",
        risk="high",
        ctx={
            "task_id": "task_123",
            "args": {"old": "a", "new": "b"},
            "proposed_by": "agent:planner",
        },
        actor="agent:planner",
    )
    assert result is not None
