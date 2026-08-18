"""事件日志格式化与 UI 侧事件适配器。"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.runtime.kernel.event import Event
from app.core.runtime.kernel.execution_repository import STATUS_RETRYING
from app.core.runtime.read_ports._common import kernel
from app.core.runtime.read_ports.approvals import query_pending_approval_count

# Product-facing name for Lane A STATUS_RETRYING (must not leak scheduler literal).
_TRUST_STATUS_IN_RETRY = "in_retry"


def _goal_id_for(event: Event) -> str | None:
    """从事件的聚合或 payload 提取 goal_id。

    goal_id 来自 work_item payload 的 parent_work_id，或根 goal 自身的 aggregate_id。
    """
    if event.aggregate_type == "work_item":
        return event.payload.get("parent_work_id") or event.aggregate_id
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
    """返回目标范围内的事件（goal 自身 + 经 parent_work_id 关联的子项）。"""
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


def reconstruct_execution_trace(correlation_id: str) -> dict[str, Any]:
    """Rebuild one Agent/capability execution from event_log by correlation_id.

    Reuses existing events — no new event types. Missing fields stay None.
    """
    if not correlation_id:
        return {
            "correlation_id": "",
            "user_request": None,
            "work_items": [],
            "context": {},
            "models": [],
            "tools": [],
            "approvals": [],
            "state_transitions": [],
            "final_result": None,
            "events": [],
        }

    events = kernel().read_events(correlation_id=correlation_id, order="asc")
    user_request = None
    work_items: list[dict[str, Any]] = []
    context: dict[str, Any] = {}
    models: list[dict[str, Any]] = []
    tools: list[dict[str, Any]] = []
    approvals: list[dict[str, Any]] = []
    state_transitions: list[dict[str, Any]] = []
    final_result: dict[str, Any] | None = None

    for event in events:
        p = event.payload or {}
        if event.type == "ChatRequested":
            user_request = p.get("user_message") or user_request
        elif event.type == "ChatCompleted":
            context = {
                "fragment_ids": p.get("fragment_ids") or [],
                "intent_tags": p.get("intent_tags") or [],
            }
            final_result = {
                "status": p.get("status"),
                "content": p.get("content"),
                "pending": p.get("pending"),
                "approval_id": p.get("approval_id"),
            }
        elif event.type == "LLMCallRecorded":
            models.append({
                "provider": p.get("provider"),
                "model": p.get("model"),
                "prompt_tokens": p.get("prompt_tokens"),
                "completion_tokens": p.get("completion_tokens"),
                "cost": p.get("cost"),
                "success": p.get("success"),
                "prompt_hash": p.get("prompt_hash"),
                "purpose": p.get("purpose"),
            })
        elif event.type in ("CapabilityInvoked", "CapabilityFailed", "CapabilityDenied"):
            reason = str(p.get("reason") or "")
            if event.type == "CapabilityInvoked":
                success = True
                outcome = p.get("outcome") or "success"
            elif event.type == "CapabilityDenied":
                deferred = reason == "deferred" or bool(p.get("approval_id"))
                success = False
                outcome = p.get("outcome") or (
                    "approval_required" if deferred else "authorization_failure"
                )
            else:
                success = False
                outcome = p.get("outcome") or "tool_execution_failure"
            tools.append({
                "name": p.get("name"),
                "event": event.type,
                "success": success,
                "outcome": outcome,
                "error": p.get("error") or p.get("reason"),
                "latency_ms": p.get("latency_ms"),
            })
        elif event.type in ("ApprovalRequested", "ApprovalGranted", "ApprovalDenied"):
            approvals.append({
                "event": event.type,
                "action": p.get("action"),
                "status": p.get("status"),
                "approval_id": event.aggregate_id,
                "reason": p.get("reason"),
            })
        elif event.type in ("WorkItemCreated", "WorkItemUpdated", "WorkItemStatusChanged"):
            work_items.append({
                "event": event.type,
                "id": event.aggregate_id,
                "title": p.get("title"),
                "status": p.get("status"),
            })
            if event.type == "WorkItemStatusChanged":
                state_transitions.append({
                    "aggregate_id": event.aggregate_id,
                    "status": p.get("status"),
                    "ts": event.ts,
                })
        elif event.type in (
            "ExecutionRequested", "ExecutionStarted",
            "ExecutionCompleted", "ExecutionFailed",
            "ExecuteRequested", "ExecuteCompleted",
        ):
            state_transitions.append({
                "event": event.type,
                "aggregate_id": event.aggregate_id,
                "status": p.get("status") or event.type,
                "ts": event.ts,
            })

    return {
        "correlation_id": correlation_id,
        "user_request": user_request,
        "work_items": work_items,
        "context": context,
        "models": models,
        "tools": tools,
        "approvals": approvals,
        "state_transitions": state_transitions,
        "final_result": final_result,
        "events": [
            {"type": e.type, "ts": e.ts, "aggregate_id": e.aggregate_id}
            for e in events
        ],
    }


def _public_execution(item: Any) -> dict[str, Any]:
    error = getattr(item, "error", None) or None
    if isinstance(error, str) and len(error) > 200:
        error = error[:200]
    return {
        "id": getattr(item, "id", "") or "",
        "status": getattr(item, "status", "") or "",
        "handler_name": getattr(item, "handler_name", "") or "",
        "event_type": getattr(item, "event_type", "") or "",
        "error": error,
        "retry_count": int(getattr(item, "retry_count", 0) or 0),
        "dead_letter": bool(getattr(item, "dead_letter", False)),
        "created_at": getattr(item, "created_at", "") or "",
        "completed_at": getattr(item, "completed_at", None) or None,
        "correlation_id": getattr(item, "correlation_id", "") or "",
    }


def _newest_executions(items: list[Any], limit: int) -> list[dict[str, Any]]:
    """Execution repository results are ascending by created_at."""
    if limit <= 0 or not items:
        return []
    return [_public_execution(item) for item in reversed(items[-limit:])]


def _public_execution_for_trust(item: Any) -> dict[str, Any]:
    """Trust summary row — map Lane A scheduler status to product-facing names."""
    row = _public_execution(item)
    if row.get("status") == STATUS_RETRYING:
        row = {**row, "status": _TRUST_STATUS_IN_RETRY}
    return row


def _newest_trust_executions(items: list[Any], limit: int) -> list[dict[str, Any]]:
    if limit <= 0 or not items:
        return []
    return [_public_execution_for_trust(item) for item in reversed(items[-limit:])]


def _trust_by_status(raw: dict[str, int] | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, value in (raw or {}).items():
        name = _TRUST_STATUS_IN_RETRY if str(key) == STATUS_RETRYING else str(key)
        out[name] = int(value)
    return out


def query_execution_trust_summary(*, recent_limit: int = 5) -> dict[str, Any]:
    """Dashboard-facing Lane A health: pending / failed / retry / dead-letter."""
    runtime = kernel()
    by_status = runtime.count_scheduled_executions_by_status()
    failed_rows = runtime.read_scheduled_executions(status="failed")
    in_retry_rows = runtime.read_scheduled_executions(status=STATUS_RETRYING)
    completed_rows = runtime.read_scheduled_executions(status="completed")
    dead_rows = runtime.list_dead_letter_executions()
    failed = _newest_executions(failed_rows, recent_limit)
    last_completed = _newest_executions(completed_rows, 1)
    last_failed = failed[:1]
    return {
        "by_status": _trust_by_status(by_status),
        "pending_approvals": int(query_pending_approval_count() or 0),
        "failed": failed,
        "in_retry": _newest_trust_executions(in_retry_rows, recent_limit),
        "dead_letter": _newest_executions(dead_rows, recent_limit),
        "dead_letter_count": len(dead_rows),
        "last_completed": last_completed[0] if last_completed else None,
        "last_failed": last_failed[0] if last_failed else None,
    }


def conversation_chat_in_flight(conv_id: str) -> bool:
    """True when a ChatRequested execution is still pending/running/in retry."""
    from app.core.runtime.kernel.execution_repository import (
        STATUS_PENDING,
        STATUS_RETRYING,
        STATUS_RUNNING,
    )

    active = {STATUS_RUNNING, STATUS_PENDING, STATUS_RETRYING}
    runtime = kernel()
    events = runtime.read_events(aggregate_id=conv_id, type="ChatRequested", limit=10)
    for event in events:
        cid = event.correlation_id or ""
        if not cid:
            continue
        for status in active:
            rows = runtime.read_scheduled_executions(status=status)
            if any(
                row.correlation_id == cid and row.event_type == "ChatRequested"
                for row in rows
            ):
                return True
    return False
