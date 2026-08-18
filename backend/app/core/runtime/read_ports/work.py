"""Work-item / goal 端口——投影读取与 Work 变更（API ABI）。

读助手查询受治理的 ``work_items``。变更助手是对 ``work_item_engine`` 的薄
惰性包装，使 API 不直接导入该模块（避免 work_item_engine ↔ read_ports 的
导入环）。
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.runtime.read_ports._common import kernel

logger = logging.getLogger(__name__)


def query_pending_work_items(*, limit: int = 100) -> list[dict[str, Any]]:
    """Query pending work items (timeline / cron / fragments)."""
    return kernel().query_state(
        "work_items",
        status="pending",
        limit=limit,
        order="created_at_asc",
    )


def query_top_active_goals(*, limit: int = 5) -> list[dict[str, Any]]:
    """Top active goals ordered by importance × urgency.

    Reads from work_items(work_type='goal').
    """
    return kernel().query_state(
        "work_items", work_type="goal",
        status="active",
        limit=limit,
        order="importance_urgency_desc",
    )


def query_stagnant_goals(*, days: int = 3, limit: int = 10) -> list[dict[str, Any]]:
    """Active goals with no recent activity (Work subtype work_type=goal)."""
    return kernel().query_state(
        "work_items",
        work_type="goal",
        status="active",
        last_activity_older_than_days=days,
        limit=limit,
    )


def query_stagnant_goal_count(*, days: int = 3) -> int:
    """Count active goals with no recent activity."""
    try:
        return kernel().count_state(
            "work_items",
            work_type="goal",
            status="active",
            last_activity_older_than_days=days,
        )
    except Exception:
        logger.exception("query_stagnant_goal_count failed")
        raise


def query_work_item(item_id: str) -> dict[str, Any] | None:
    """Fetch a single work_items row by id."""
    rows = kernel().query_state("work_items", id=item_id, limit=1)
    return rows[0] if rows else None


def query_work_items(**filters: Any) -> list[dict[str, Any]]:
    """Pass-through work_items query — prefer more specific helpers when possible."""
    return kernel().query_state("work_items", **filters)


def query_goals(*, status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """List goals (work_type=goal)."""
    filters: dict[str, Any] = {"work_type": "goal", "limit": limit}
    if status:
        filters["status"] = status
    return kernel().query_state("work_items", **filters)


def count_goals(*, status: str | None = None) -> int:
    """Count goals."""
    filters: dict[str, Any] = {"work_type": "goal"}
    if status:
        filters["status"] = status
    return kernel().count_state("work_items", **filters)


def query_goal(goal_id: str) -> dict[str, Any] | None:
    rows = kernel().query_state("work_items", work_type="goal", id=goal_id, limit=1)
    return rows[0] if rows else None


def query_goal_actions(goal_id: str) -> list[dict[str, Any]]:
    """Child actions of a goal."""
    return kernel().query_state(
        "work_items", parent_work_id=goal_id, work_type="action",
    )


def query_work_items_by_parent_goal(
    goal_id: str,
    *,
    limit: int = 500,
) -> list[dict[str, Any]]:
    return kernel().query_state("work_items", parent_work_id=goal_id, limit=limit)


def query_active_goals(
    *,
    limit: int = 20,
    order: str = "importance_desc",
) -> list[dict[str, Any]]:
    return kernel().query_state(
        "work_items",
        work_type="goal",
        status="active",
        limit=limit,
        order=order,
    )


def count_active_goals() -> int:
    return kernel().count_state(
        "work_items",
        work_type="goal",
        status="active",
    )


def query_completed_goals(
    *,
    limit: int = 5000,
    updated_since: str | None = None,
) -> list[dict[str, Any]]:
    filters: dict[str, Any] = {
        "work_type": "goal",
        "status": "completed",
        "limit": limit,
    }
    if updated_since:
        filters["updated_since"] = updated_since
    return kernel().query_state("work_items", **filters)


def count_completed_goals(
    *,
    updated_since: str | None = None,
) -> int:
    filters: dict[str, Any] = {
        "work_type": "goal",
        "status": "completed",
    }
    if updated_since:
        filters["updated_since"] = updated_since
    return kernel().count_state("work_items", **filters)


def query_goals_with_deadline(*, limit: int = 500) -> list[dict[str, Any]]:
    """Active goals that have a deadline set."""
    return kernel().query_state(
        "work_items",
        work_type="goal",
        status="active",
        has_deadline=True,
        limit=limit,
    )


# ── Work mutations (API-facing ABI; lazy to avoid work_item_engine ↔ read_ports cycles)


def create_work_item(
    title: str,
    *,
    description: str = "",
    work_type: str = "task",
    parent_work_id: str | None = None,
    priority: int = 0,
    dependencies: list[str] | None = None,
    executable_plan: str | None = None,
    progress: float | None = None,
    importance: float | None = None,
    urgency: float | None = None,
    deadline: str | None = None,
    last_activity_at: str | None = None,
    status: str = "pending",
) -> dict[str, Any]:
    from app.core.runtime.work_item_engine import create_work_item as _create

    return _create(
        title,
        description=description,
        work_type=work_type,
        parent_work_id=parent_work_id,
        priority=priority,
        dependencies=dependencies,
        executable_plan=executable_plan,
        progress=progress,
        importance=importance,
        urgency=urgency,
        deadline=deadline,
        last_activity_at=last_activity_at,
        status=status,
    )


def update_work_item_fields(
    item_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    status: str | None = None,
    priority: int | None = None,
    progress: float | None = None,
    importance: float | None = None,
    urgency: float | None = None,
    deadline: str | None = None,
    last_activity_at: str | None = None,
    parent_work_id: str | None = None,
) -> dict[str, Any] | None:
    from app.core.runtime.work_item_engine import update_work_item_fields as _update

    return _update(
        item_id,
        title=title,
        description=description,
        status=status,
        priority=priority,
        progress=progress,
        importance=importance,
        urgency=urgency,
        deadline=deadline,
        last_activity_at=last_activity_at,
        parent_work_id=parent_work_id,
    )


def update_work_item_status(item_id: str, new_status: str) -> dict[str, Any] | None:
    from app.core.runtime.work_item_engine import update_work_item_status as _update

    return _update(item_id, new_status)


def delete_work_item(item_id: str, *, cascade: bool = False) -> None:
    from app.core.runtime.work_item_engine import delete_work_item as _delete

    _delete(item_id, cascade=cascade)


def get_sub_work_items(parent_work_id: str) -> list[dict[str, Any]]:
    from app.core.runtime.work_item_engine import get_sub_work_items as _get

    return _get(parent_work_id)


def get_work_item_tree(goal_id: str) -> list[dict[str, Any]]:
    from app.core.runtime.work_item_engine import get_work_item_tree as _get

    return _get(goal_id)


def list_work_items(
    status: str | None = None,
    work_type: str | None = None,
    limit: int = 50,
    parent_work_id: str | None = None,
) -> list[dict[str, Any]]:
    from app.core.runtime.work_item_engine import list_work_items as _list

    return _list(
        status=status,
        work_type=work_type,
        limit=limit,
        parent_work_id=parent_work_id,
    )


def bump_parent_activity(parent_id: str) -> None:
    from app.core.runtime.work_item_engine import bump_parent_activity as _bump

    _bump(parent_id)


def notify_goal_action_completed(
    goal_id: str,
    action_id: str,
    action_title: str,
) -> None:
    """Notify when a goal's child action completes.

    Shared by the Work API status transitions and ExecuteRequested completion
    so plan execution does not skip product side-effects.

    Does **not** write MemoryDerived: ``actor=system`` would land as
    ``origin=claim`` / ``proposed``, and the extractor already treats
    「完成了行动步骤」 as noise (dogfood W34-R2).
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        all_items = query_work_items_by_parent_goal(goal_id, limit=500)

        # 确保刚完成的 action 被计入，即使并发读与投影器竞争
        #（emit 是同步的，但此处做双保险）。
        for item in all_items:
            if item["id"] == action_id:
                item["status"] = "completed"

        if all_items:
            # 目标有子项才统计进度；无子项（孤儿 action / 数据不一致）时
            # 跳过通知，避免产生 "0/0 步已完成" 的噪音。
            completed = sum(
                1 for a in all_items if a.get("status") == "completed"
            )
            all_done = all(
                a.get("status") == "completed" for a in all_items
            )
            from app.core.runtime.read_ports.notifications import create_notification

            goal_row = query_goal(goal_id)
            goal_title = goal_row["title"] if goal_row else "目标"

            if all_done:
                create_notification(
                    "goal_complete",
                    f"目标「{goal_title}」的所有步骤已完成",
                    f"你完成了所有行动步骤：{goal_title}。可以去目标页标记完成，或让 AI 帮你总结经验。",
                )
            else:
                create_notification(
                    "goal_progress",
                    f"完成一步：{action_title}",
                    f"目标「{goal_title}」进度：{completed}/{len(all_items)} 步已完成。",
                )

    except Exception:
        logger.warning(
            "Failed to notify goal action completed for action_id=%s",
            action_id,
            exc_info=True,
        )


_TERMINAL_EXECUTE_STATUSES = frozenset({"completed", "cancelled"})
_BLOCKED_EXECUTE_STATUSES = frozenset({"running", "waiting_approval"})
_TERMINAL_BACKGROUND_STATUSES = frozenset({"completed", "failed", "cancelled"})


def query_background_work_item(item_id: str) -> dict[str, Any] | None:
    """Fetch a background work item (``work_type=background``) or None."""
    row = query_work_item(item_id)
    if row is None or row.get("work_type") != "background":
        return None
    return row


def query_background_work_items(
    *,
    status: str | None = None,
    limit: int = 50,
    order: str | None = None,
) -> list[dict[str, Any]]:
    """List background work items as native ``work_items`` rows."""
    filters: dict[str, Any] = {
        "work_type": "background",
        "limit": limit,
    }
    if status:
        filters["status"] = status
    if order:
        filters["order"] = order
    return query_work_items(**filters)


def cancel_background_work_item(item_id: str) -> dict[str, Any]:
    """Cancel a non-terminal background work item (Ports command ABI).

    Sets the cooperative cancel flag for ``exec_{item_id}``, cancels matching
    Lane A ``ExecuteRequested`` handlers when the Scheduler is alive, clears
    plan resumes, and emits ``WorkItemStatusChanged(cancelled)``.
    """
    from app.core.runtime.execution import request_cancel_execution
    from app.core.runtime.kernel.constants import (
        AGGREGATE_WORK_ITEM,
        EVENT_WORK_ITEM_STATUS_CHANGED,
    )
    from app.core.runtime.plan_resume import clear_plan_resumes_for_work_item

    item = query_work_item(item_id)
    if item is None or item.get("work_type") != "background":
        raise KeyError(item_id)

    status = item.get("status") or ""
    if status in _TERMINAL_BACKGROUND_STATUSES:
        raise ValueError(f"Task already terminal ({status})")

    exec_id = f"exec_{item_id}"
    request_cancel_execution(exec_id)

    try:
        from app.core.runtime.agent_scheduler import get_scheduler
        from app.core.runtime.runtime_container import runtime

        if runtime._scheduler is not None:
            get_scheduler(kernel()).cancel_executions_for(item_id)
    except Exception:
        logger.debug("Scheduler cancel for background work item skipped", exc_info=True)

    clear_plan_resumes_for_work_item(item_id, kernel=kernel())

    kernel().emit_event(
        EVENT_WORK_ITEM_STATUS_CHANGED,
        AGGREGATE_WORK_ITEM,
        item_id,
        payload={"status": "cancelled"},
        actor="user",
    )

    updated = query_background_work_item(item_id)
    if updated is None:
        raise RuntimeError("Task missing after cancel")
    return updated


def request_work_item_execute(item_id: str) -> dict[str, Any]:
    """Start a work item's ``executable_plan`` (Ports command ABI).

    Emits ``WorkItemStatusChanged(running)`` then ``ExecuteRequested``.
    The Scheduler dispatches the handler asynchronously; completion updates
    the work-item status via ``WorkItemStatusChanged`` from the handler.
    """
    import json

    from app.core.runtime.kernel.constants import (
        AGGREGATE_WORK_ITEM,
        EVENT_EXECUTE_REQUESTED,
        EVENT_WORK_ITEM_STATUS_CHANGED,
    )

    item = query_work_item(item_id)
    if item is None:
        raise KeyError(item_id)

    if item.get("work_type") == "goal":
        raise ValueError("Goals cannot be executed; run child actions instead")

    plan_raw = item.get("executable_plan")
    if not isinstance(plan_raw, str) or not plan_raw.strip():
        raise ValueError("Work item has no executable_plan")
    try:
        plan_obj = json.loads(plan_raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid executable_plan JSON: {exc}") from exc
    if not isinstance(plan_obj, dict) or not isinstance(plan_obj.get("steps"), list):
        raise ValueError("executable_plan must be an object with a steps list")
    if not any(isinstance(s, dict) for s in plan_obj["steps"]):
        raise ValueError("executable_plan has no steps")

    status = item.get("status") or "pending"
    if status in _TERMINAL_EXECUTE_STATUSES:
        raise ValueError(f"Work item already terminal ({status})")
    if status in _BLOCKED_EXECUTE_STATUSES:
        raise ValueError(
            f"Work item is {status}; wait for completion or resolve approval"
        )

    k = kernel()
    k.emit_event(
        EVENT_WORK_ITEM_STATUS_CHANGED,
        AGGREGATE_WORK_ITEM,
        item_id,
        payload={"status": "running"},
        actor="user",
    )
    k.emit_event(
        EVENT_EXECUTE_REQUESTED,
        "action",
        f"exec_{item_id}",
        payload={"action_id": item_id},
        actor="user",
    )

    updated = query_work_item(item_id)
    if updated is None:
        raise RuntimeError("Work item missing after execute request")
    return updated


def work_item_execution_snapshot(item_id: str, item: dict[str, Any] | None = None) -> dict[str, Any]:
    """Aggregate plan steps + progress + Lane-A execution row for the Tasks UI."""
    import json

    from app.core.runtime.plan_resume import load_plan_progress

    row = item if item is not None else query_work_item(item_id)
    if row is None:
        raise KeyError(item_id)

    plan_raw = row.get("executable_plan")
    steps: list = []
    if isinstance(plan_raw, str) and plan_raw.strip():
        try:
            plan_obj = json.loads(plan_raw)
        except json.JSONDecodeError:
            plan_obj = None
        if isinstance(plan_obj, dict) and isinstance(plan_obj.get("steps"), list):
            steps = plan_obj["steps"]

    progress = load_plan_progress(item_id, kernel=kernel())
    resume_from = int(progress.resume_from) if progress is not None else 0
    previous_output = dict(progress.previous_output or {}) if progress else {}

    exec_id = f"exec_{item_id}"
    scheduled = kernel().read_scheduled_execution(exec_id)
    handler: dict[str, Any] | None = None
    if scheduled is not None:
        handler = {
            "id": scheduled.id,
            "status": scheduled.status,
            "dead_letter": bool(getattr(scheduled, "dead_letter", False)),
            "retry_count": int(getattr(scheduled, "retry_count", 0) or 0),
            "handler_name": getattr(scheduled, "handler_name", "") or "",
            "started_at": getattr(scheduled, "started_at", None),
            "completed_at": getattr(scheduled, "completed_at", None),
        }

    return {
        "steps": steps,
        "resume_from": resume_from,
        "previous_output": previous_output,
        "handler_execution": handler,
    }

