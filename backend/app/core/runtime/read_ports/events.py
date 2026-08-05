"""事件日志格式化与 UI 侧事件适配器。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.runtime.kernel.event import Event
from app.core.runtime.read_ports._common import kernel


def _goal_id_for(event: Event) -> str | None:
    """从事件的聚合或 payload 提取 goal_id。

    goal_id 来自 work_item payload 的 parent_goal_id，或根 goal 自身的 aggregate_id。
    """
    if event.aggregate_type == "work_item":
        return event.payload.get("parent_goal_id") or event.aggregate_id
    return event.payload.get("goal_id")


def _summary_for(event: Event) -> str:
    """为事件生成人类可读的摘要字符串。"""
    p = event.payload
    t = event.type
    if t == "CapabilityInvoked":
        return f"Tool called: {p.get('name', '')}"
    if t == "ApprovalRequested":
        return f"Approval requested: {p.get('action', '')}"
    if t == "ApprovalGranted":
        return f"Approval granted: {p.get('action', '')}"
    if t == "ApprovalDenied":
        return f"Approval denied: {p.get('action', '')}"
    if t == "WorkItemCreated":
        return f"WorkItem created: {p.get('title', '')}"
    if t in ("WorkItemStatusChanged", "WorkItemUpdated"):
        return f"WorkItem {p.get('status', t)}: {event.aggregate_id}"
    if t == "MemoryDerived":
        return f"Memory derived: {str(p.get('content', ''))[:60]}"
    if t == "ConversationRecorded":
        return f"Conversation: {str(p.get('user_message', ''))[:60]}"
    return f"{t}: {event.aggregate_id}"


def to_event_dict(event: Event) -> dict:
    """把 Kernel 事件转成 UI 友好的 dict 形状（type 使用真实事件名）。"""
    payload = event.payload or {}
    return {
        "id": event.id,
        "type": event.type,
        "summary": _summary_for(event),
        "goal_id": _goal_id_for(event),
        "payload": json.dumps(payload) if payload else None,
        "timestamp": event.ts,
    }


def goal_events(goal_id: str, *, limit: int = 20) -> list[dict]:
    """返回目标范围内的事件（goal 自身 + 经 parent_goal_id 关联的子项）。"""
    from app.core.runtime.kernel_instance import kernel

    own_ev = kernel.read_events(
        aggregate_type="work_item", aggregate_id=goal_id, order="desc", limit=limit,
    )
    child_ev = kernel.read_events(
        aggregate_type="work_item", payload_goal_id=goal_id,
        order="desc", limit=limit,
    )
    combined = sorted(own_ev + child_ev, key=lambda e: e.seq or 0, reverse=True)[:limit]
    return [to_event_dict(e) for e in combined]


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
    rows = [to_event_dict(e) for e in events]

    if goal_id:
        rows = [r for r in rows if r.get("goal_id") == goal_id]

    return rows[:limit]


def query_recent_events(*, days: int = 7, limit: int = 20) -> list[dict[str, Any]]:
    return recent_events(
        kernel().read_events,
        days=days,
        limit=limit,
    )
