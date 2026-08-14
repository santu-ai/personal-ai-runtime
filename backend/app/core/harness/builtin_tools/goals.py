"""Goals MCP Server — let AI manage user goals within conversations.

Bridges the gap between conversation and goal management: AI can create goals,
update progress, and mark goals complete without the user switching to the
Goals page.

Architectural split:

- ``_writer_*`` module-level functions are the real tool handlers registered
  with ``mcp_hub``. They perform the actual ``emit_event`` and run only after
  the gate has allowed the call, so ``CapabilityInvoked`` is always emitted
  alongside the ``WorkItem*`` event.
- ``GoalsServer.list_active_goals`` is the read-only LLM-facing surface.
"""
import json
import uuid

from app.core.harness.mcp_hub import (
    OUTCOME_TOOL_EXECUTION_FAILURE,
    ToolInvokeError,
)

# ─── Capability handlers (called by mcp_hub after gate allows) ──────────────
# These own the emit_event side effects. Registered as tool handlers below.


def _writer_create_goal(
    title: str,
    description: str = "",
    importance: float = 0.5,
    deadline: str = "",
) -> str:
    """Tool handler — emit WorkItemCreated for a new goal.

    Invoked only after ``invoke_capability('create_goal')`` has passed the
    3-gate decision, so the resulting ``WorkItemCreated`` event is paired
    with a ``CapabilityInvoked`` audit record.
    """
    from app.core.runtime.kernel_instance import kernel

    goal_id = str(uuid.uuid4())

    kernel.emit_event(
        "WorkItemCreated",
        "work_item",
        goal_id,
        payload={
            "title": title,
            "description": description or "",
            "work_type": "goal",
            "status": "active",
            "importance": importance,
            "urgency": 0.5,
        } | ({"deadline": deadline} if deadline else {}),
        actor="user",
    )

    return json.dumps({
        "goal_id": goal_id,
        "title": title,
        "status": "created",
        "message": f"已创建目标「{title}」",
    }, ensure_ascii=False)


def _writer_update_goal_progress(
    goal_id: str,
    progress: float,
    note: str = "",
) -> str:
    """Tool handler — emit WorkItemUpdated for a progress change."""
    from app.core.runtime.kernel_instance import kernel

    progress = max(0.0, min(1.0, progress))

    kernel.emit_event(
        "WorkItemUpdated",
        "work_item",
        goal_id,
        payload={"progress": progress},
        actor="user",
    )

    msg = f"目标进度已更新为 {progress * 100:.0f}%"
    if note:
        msg += f"（{note}）"

    return json.dumps({
        "goal_id": goal_id,
        "progress": progress,
        "status": "updated",
        "message": msg,
    }, ensure_ascii=False)


def _writer_complete_goal(goal_id: str, reflection: str = "") -> str:
    """Tool handler — emit WorkItemStatusChanged to complete a goal."""
    from app.core.runtime.kernel_instance import kernel

    kernel.emit_event(
        "WorkItemStatusChanged",
        "work_item",
        goal_id,
        payload={"status": "completed"},
        actor="user",
    )

    # 如果有反思，存入记忆（read-only capability path, not a goal write)
    if reflection:
        from app.core.agents.memory_engine import memory_engine
        memory_engine.store_memory(
            category="event",
            content=f"完成目标：{reflection}",
            source=f"goal:{goal_id}",
            actor="user",
        )

    return json.dumps({
        "goal_id": goal_id,
        "status": "completed",
        "message": "目标已完成！干得漂亮。" + (f" 已记录你的心得：{reflection}" if reflection else ""),
    }, ensure_ascii=False)


def _writer_delete_goal(goal_id: str) -> str:
    """Tool handler — emit WorkItemDeleted for a goal (cascades to children)."""
    from app.core.runtime import read_ports
    from app.core.runtime.kernel_instance import kernel

    goal = read_ports.query_goal(goal_id)
    if not goal:
        raise ToolInvokeError(
            OUTCOME_TOOL_EXECUTION_FAILURE, f"未找到目标 {goal_id}",
        )

    title = goal.get("title", "")

    # Cascade: delete children first
    for child in read_ports.query_work_items_by_parent_goal(goal_id):
        kernel.emit_event("WorkItemDeleted", "work_item", child["id"], actor="user")
    from app.core.runtime.work_item_engine import get_sub_work_items
    for child in get_sub_work_items(goal_id):
        kernel.emit_event("WorkItemDeleted", "work_item", child["id"], actor="user")
    kernel.emit_event("WorkItemDeleted", "work_item", goal_id, actor="user")

    return json.dumps({
        "goal_id": goal_id,
        "title": title,
        "status": "deleted",
        "message": f"已删除目标「{title}」及其关联行动步骤",
    }, ensure_ascii=False)


class GoalsServer:
    """Read-only goal surface for LLM tools (writes go through mcp_hub writers)."""

    def list_active_goals(self) -> str:
        """List the user's active goals.

        Read-only path; no capability gate required (matches the existing
        auto_allow classification in capability_policy.json).

        Reads from work_items(work_type='goal').
        """
        from app.core.runtime import read_ports

        goals = read_ports.query_active_goals(limit=500, order="importance_desc")

        return json.dumps({
            "count": len(goals),
            "goals": [{"id": g["id"], "title": g["title"], "progress": g.get("progress", 0),
                        "importance": g.get("importance", 0.5)} for g in goals],
        }, ensure_ascii=False)


goals_server = GoalsServer()
