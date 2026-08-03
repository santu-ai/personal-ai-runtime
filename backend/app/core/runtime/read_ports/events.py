"""事件日志格式化与 UI 侧事件适配器。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.runtime.kernel.event import Event
from app.core.runtime.read_ports._common import kernel

_LEGACY_TYPE: dict[str, str] = {
    "ActionCreated": "action_created",
    "ActionUpdated": "action_status_changed",
    "ActionDeleted": "action_deleted",
    "WorkItemCreated": "task_created",
    "WorkItemUpdated": "task_status_changed",
    "WorkItemStatusChanged": "task_status_changed",
    "WorkItemDeleted": "task_status_changed",
    "CapabilityInvoked": "tool_call",
    "ApprovalRequested": "approval_requested",
    "ApprovalGranted": "approval_granted",
    "ApprovalDenied": "approval_denied",
    "TaskCreated": "task_created",
    "TaskCompleted": "task_completed",
    "TaskFailed": "task_failed",
    "TaskStatusChanged": "task_status_changed",
    "MemoryDerived": "memory_derived",
    "ConversationRecorded": "conversation",
}


def _goal_id_for(event: Event) -> str | None:
    """从事件的聚合或 payload 提取 goal_id。

    v1.0：Goal 聚合已退休。goal_id 来自 work_item payload 或 parent_goal_id。
    """
    if event.aggregate_type == "work_item":
        return event.payload.get("parent_goal_id") or event.aggregate_id
    if event.aggregate_type in ("action"):
        return event.payload.get("goal_id") or event.payload.get("parent_goal_id")
    return event.payload.get("goal_id")


def _summary_for(event: Event) -> str:
    """为事件生成人类可读的摘要字符串。"""
    p = event.payload
    t = event.type
    if t == "ActionCreated":
        return f"Action created: {p.get('title', '')}"
    if t == "ActionUpdated":
        return f"Action status -> {p.get('status', '')}"
    if t == "CapabilityInvoked":
        return f"Tool called: {p.get('name', '')}"
    if t == "ApprovalRequested":
        return f"Approval requested: {p.get('action', '')}"
    if t == "ApprovalGranted":
        return f"Approval granted: {p.get('action', '')}"
    if t == "ApprovalDenied":
        return f"Approval denied: {p.get('action', '')}"
    if t == "TaskCreated":
        return f"Task created: {p.get('name', '')}"
    if t in ("TaskCompleted", "TaskFailed", "TaskStatusChanged"):
        return f"Task {p.get('status', t)}: {event.aggregate_id}"
    if t == "WorkItemCreated":
        return f"WorkItem created: {p.get('title', '')}"
    if t in ("WorkItemStatusChanged", "WorkItemUpdated"):
        return f"WorkItem {p.get('status', t)}: {event.aggregate_id}"
    if t == "MemoryDerived":
        return f"Memory derived: {str(p.get('content', ''))[:60]}"
    if t == "ConversationRecorded":
        return f"Conversation: {str(p.get('user_message', ''))[:60]}"
    return f"{t}: {event.aggregate_id}"


def to_legacy_dict(event: Event) -> dict:
    """把 Kernel 事件转成 UI 友好的 dict 形状。"""
    legacy_type = _LEGACY_TYPE.get(event.type, event.type.lower())
    payload = event.payload or {}
    return {
        "id": event.id,
        "type": legacy_type,
        "summary": _summary_for(event),
        "goal_id": _goal_id_for(event),
        "payload": json.dumps(payload) if payload else None,
        "timestamp": event.ts,
    }


def goal_events(goal_id: str, *, limit: int = 20) -> list[dict]:
    """返回目标范围内的事件（goal + 相关 actions/work_items）。"""
    from app.core.runtime.kernel_instance import kernel

    goal_ev = kernel.read_events(
        aggregate_type="goal", aggregate_id=goal_id, order="desc", limit=limit,
    )
    action_ev = kernel.read_events(
        aggregate_type="action", payload_goal_id=goal_id,
        order="desc", limit=limit,
    )
    # work_item：goal 自身事件（aggregate_id == goal_id）加经
    # payload.parent_goal_id 关联的子项。
    own_ev = kernel.read_events(
        aggregate_type="work_item", aggregate_id=goal_id, order="desc", limit=limit,
    )
    child_ev = kernel.read_events(
        aggregate_type="work_item", payload_goal_id=goal_id,
        order="desc", limit=limit,
    )
    combined = sorted(goal_ev + action_ev + own_ev + child_ev, key=lambda e: e.seq or 0, reverse=True)[:limit]
    return [to_legacy_dict(e) for e in combined]


def recent_events(
    read_fn,
    *,
    days: int = 7,
    limit: int = 50,
    event_type: str | None = None,
    goal_id: str | None = None,
) -> list[dict]:
    """从 event_log 读取近期事件并返回 UI 友好的行。"""
    since_ts = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    filters: dict = {"since_ts": since_ts, "limit": limit, "order": "desc"}
    if event_type:
        filters["type"] = event_type

    events = read_fn(**filters)
    rows = [to_legacy_dict(e) for e in events]

    if goal_id:
        rows = [r for r in rows if r.get("goal_id") == goal_id]

    return rows[:limit]


def query_recent_legacy_events(*, days: int = 7, limit: int = 20) -> list[dict[str, Any]]:
    return recent_events(
        kernel().read_events,
        days=days,
        limit=limit,
    )

