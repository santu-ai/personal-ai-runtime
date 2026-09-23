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


def _work_id_on_execute_event(event: Any) -> str:
    """Work id already stored on an ``ExecuteRequested`` trigger.

    Same association as ``runtime_loop._work_id_for_execute_execution``:
    ``payload.action_id``, otherwise the ``exec_`` aggregate id. An explicit
    ``action_id`` is not replaced by the aggregate suffix.
    """
    from app.core.runtime.kernel.constants import EVENT_EXECUTE_REQUESTED

    if getattr(event, "type", None) != EVENT_EXECUTE_REQUESTED:
        return ""
    payload = event.payload if isinstance(getattr(event, "payload", None), dict) else {}
    action_id = str(payload.get("action_id") or "").strip()
    if action_id:
        return action_id
    aggregate_id = str(getattr(event, "aggregate_id", "") or "")
    prefix = "exec_"
    if aggregate_id.startswith(prefix):
        return aggregate_id[len(prefix):].strip()
    return ""


def _associated_work_id(runtime: Any, item: Any, cache: dict[str, str | None]) -> str | None:
    """Expose a work id only when the trigger event and work_items row already agree.

    ``correlation_id`` is not a work id. Rows without this association stay unset.
    """
    from app.core.runtime.kernel.constants import EVENT_EXECUTE_REQUESTED

    if (getattr(item, "event_type", "") or "") != EVENT_EXECUTE_REQUESTED:
        return None
    event_id = str(getattr(item, "event_id", "") or "").strip()
    if not event_id:
        return None
    if event_id not in cache:
        found = runtime.read_events(id=event_id, limit=1)
        candidate = _work_id_on_execute_event(found[0]) if found else ""
        if not candidate:
            cache[event_id] = None
        else:
            rows = runtime.query_state("work_items", id=candidate, limit=1)
            row_id = str(rows[0].get("id") or "") if rows else ""
            cache[event_id] = candidate if row_id == candidate else None
    return cache[event_id]


def _trust_execution_row(
    runtime: Any,
    item: Any,
    cache: dict[str, str | None],
    *,
    rename_retry: bool = False,
) -> dict[str, Any]:
    row = _public_execution(item)
    if rename_retry and row.get("status") == STATUS_RETRYING:
        row = {**row, "status": _TRUST_STATUS_IN_RETRY}
    return {**row, "work_id": _associated_work_id(runtime, item, cache)}


def _newest_executions(
    items: list[Any],
    limit: int,
    *,
    runtime: Any,
    cache: dict[str, str | None],
    rename_retry: bool = False,
) -> list[dict[str, Any]]:
    """Execution repository results are ascending by created_at."""
    if limit <= 0 or not items:
        return []
    return [
        _trust_execution_row(runtime, item, cache, rename_retry=rename_retry)
        for item in reversed(items[-limit:])
    ]


def _trust_by_status(raw: dict[str, int] | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, value in (raw or {}).items():
        name = _TRUST_STATUS_IN_RETRY if str(key) == STATUS_RETRYING else str(key)
        out[name] = int(value)
    return out


def query_execution_trust_summary(*, recent_limit: int = 5) -> dict[str, Any]:
    """Dashboard-facing Lane A health: pending / failed / retry / dead-letter."""
    runtime = kernel()
    cache: dict[str, str | None] = {}
    by_status = runtime.count_scheduled_executions_by_status()
    failed_rows = runtime.read_scheduled_executions(status="failed")
    in_retry_rows = runtime.read_scheduled_executions(status=STATUS_RETRYING)
    completed_rows = runtime.read_scheduled_executions(status="completed")
    dead_rows = runtime.list_dead_letter_executions()
    failed = _newest_executions(failed_rows, recent_limit, runtime=runtime, cache=cache)
    last_completed = _newest_executions(
        completed_rows, 1, runtime=runtime, cache=cache,
    )
    last_failed = failed[:1]
    return {
        "by_status": _trust_by_status(by_status),
        "pending_approvals": int(query_pending_approval_count() or 0),
        "failed": failed,
        "in_retry": _newest_executions(
            in_retry_rows, recent_limit, runtime=runtime, cache=cache, rename_retry=True,
        ),
        "dead_letter": _newest_executions(
            dead_rows, recent_limit, runtime=runtime, cache=cache,
        ),
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


def mark_external_taint(correlation_id: str, *, reason: str) -> None:
    """Mark untrusted ingress for a chat correlation (Product ABI)."""
    from app.core.runtime.taint import taint_registry

    taint_registry.mark(
        correlation_id,
        source="external_ingestion",
        reason=reason,
    )


# Work completions and inbox arrivals are replayed from existing events.
# Goal vs task comes from the work_items projection (WorkItemCreated payload
# often has work_type; the status event usually does not).
_TASK_WORK_TYPES = frozenset({"task", "action", "background"})
_PERIOD_EVENT_CAP = 1000


def _parse_ts(ts: str) -> datetime | None:
    text = (ts or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def _is_completion(event: Any) -> bool:
    """True when this event records a work item reaching completed.

    Goals complete via ``WorkItemStatusChanged``. Actions often emit
    ``WorkItemUpdated(status=completed)`` and a follow-up ``completed_at``
    stamp. Progress-only updates are not completions.
    """
    payload = getattr(event, "payload", None) or {}
    event_type = getattr(event, "type", "")
    status = payload.get("status")
    if event_type == "WorkItemStatusChanged":
        return status == "completed"
    if event_type != "WorkItemUpdated":
        return False
    if status == "completed":
        return True
    completed_at = payload.get("completed_at")
    return bool(completed_at) and status in (None, "completed")


def _count_signal(current: int, previous: int) -> dict[str, int]:
    return {"current": current, "previous": previous, "delta": current - previous}


def _rate_signal(current: float | None, previous: float | None) -> dict[str, float | None]:
    delta = None
    if current is not None and previous is not None:
        delta = current - previous
    return {"current": current, "previous": previous, "delta": delta}


def _work_types_for(item_ids: set[str]) -> dict[str, str]:
    from app.core.runtime.read_ports.work import query_work_items

    found: dict[str, str] = {}
    pending = [item_id for item_id in item_ids if item_id]
    for start in range(0, len(pending), 400):
        rows = query_work_items(id_in=pending[start:start + 400])
        for row in rows:
            work_type = row.get("work_type")
            item_id = str(row.get("id") or "")
            if item_id and work_type:
                found[item_id] = str(work_type)
    return found


def _split_completions(item_ids: set[str], types: dict[str, str]) -> dict[str, int]:
    goals = tasks = untyped = 0
    for item_id in item_ids:
        kind = types.get(item_id)
        if kind == "goal":
            goals += 1
        elif kind in _TASK_WORK_TYPES:
            tasks += 1
        else:
            untyped += 1
    return {
        "goals_completed": goals,
        "tasks_completed": tasks,
        "work_completed_untyped": untyped,
    }


def compare_periods(
    *,
    days: int = 7,
    limit: int = _PERIOD_EVENT_CAP,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Compare the last ``days`` with the previous ``days``.

    Rebuilt from existing events only: work completions
    (``WorkItemStatusChanged`` / ``WorkItemUpdated``), inbox arrivals
    (``InboxEmailRecorded``), and the same adoption decisions as the trust
    report (tool suggestions + memory claims). No new event type or table.

    The split instant belongs to the current window. An item completed more
    than once in one window counts once. Items whose projection is gone are
    reported as ``work_completed_untyped`` instead of being guessed.
    ``capped`` is true when a read hit ``limit`` and the counts may be short.
    """
    from app.core.runtime.read_ports.approvals import (
        combine_adoption,
        summarize_suggestion_adoption,
    )
    from app.core.runtime.read_ports.memory import summarize_claim_conversion

    days = min(30, max(1, int(days)))
    limit = max(1, int(limit))
    moment = _as_utc(now or datetime.now(UTC))
    current_start = moment - timedelta(days=days)
    previous_start = moment - timedelta(days=days * 2)
    previous_since = previous_start.isoformat()
    current_until = moment.isoformat()
    current_since = current_start.isoformat()
    previous_until = (current_start - timedelta(microseconds=1)).isoformat()

    def bucket(ts: str) -> str | None:
        parsed = _parse_ts(ts)
        if parsed is None:
            return None
        if current_start <= parsed <= moment:
            return "current"
        if previous_start <= parsed < current_start:
            return "previous"
        return None

    def read_events(**filters: Any) -> list[Any]:
        return kernel().read_events(
            since_ts=previous_since,
            until_ts=current_until,
            limit=limit,
            order="desc",
            **filters,
        )

    work_events = read_events(types=["WorkItemStatusChanged", "WorkItemUpdated"])
    inbox_events = read_events(type="InboxEmailRecorded")
    capped = len(work_events) >= limit or len(inbox_events) >= limit

    completions: dict[str, set[str]] = {"current": set(), "previous": set()}
    for event in work_events:
        if not _is_completion(event):
            continue
        which = bucket(str(getattr(event, "ts", "") or ""))
        aggregate_id = str(getattr(event, "aggregate_id", "") or "")
        if which and aggregate_id:
            completions[which].add(aggregate_id)

    types = _work_types_for(completions["current"] | completions["previous"])
    current_work = _split_completions(completions["current"], types)
    previous_work = _split_completions(completions["previous"], types)

    inbox: dict[str, set[str]] = {"current": set(), "previous": set()}
    for event in inbox_events:
        which = bucket(str(getattr(event, "ts", "") or ""))
        aggregate_id = str(getattr(event, "aggregate_id", "") or "")
        if which and aggregate_id:
            inbox[which].add(aggregate_id)

    def adoption_for(since: str, until: str) -> dict[str, Any]:
        nonlocal capped
        suggestions = summarize_suggestion_adoption(
            days=days, limit=limit, since_ts=since, until_ts=until,
        )
        memories = summarize_claim_conversion(
            days=days, limit=limit, since_ts=since, until_ts=until,
        )
        if suggestions.get("capped") or memories.get("capped"):
            capped = True
        return combine_adoption(suggestions, memories)

    current_adoption = adoption_for(current_since, current_until)
    previous_adoption = adoption_for(previous_since, previous_until)

    return {
        "days": days,
        "current": {"start": current_since, "end": current_until},
        "previous": {"start": previous_since, "end": current_since},
        "signals": {
            "goals_completed": _count_signal(
                current_work["goals_completed"], previous_work["goals_completed"],
            ),
            "tasks_completed": _count_signal(
                current_work["tasks_completed"], previous_work["tasks_completed"],
            ),
            "work_completed_untyped": _count_signal(
                current_work["work_completed_untyped"],
                previous_work["work_completed_untyped"],
            ),
            "inbox_recorded": _count_signal(len(inbox["current"]), len(inbox["previous"])),
            "adoption_decided": _count_signal(
                int(current_adoption["decided"]), int(previous_adoption["decided"]),
            ),
            "adoption_rate": _rate_signal(
                current_adoption.get("adoption_rate"),
                previous_adoption.get("adoption_rate"),
            ),
        },
        "adoption": {
            "current": current_adoption,
            "previous": previous_adoption,
        },
        "capped": capped,
    }


def execution_failure_reason(item_id: str, scheduled: Any) -> str | None:
    """Scheduler error, else ``ExecuteCompleted.error`` for the same trigger.

    A plan failure returns from the handler, so the scheduler clears
    ``ScheduledExecution.error`` and records ``ExecutionCompleted``. The reason
    is already on the ``ExecuteCompleted`` caused by that ``ExecuteRequested``.
    Blank text is ``None``.
    """
    raw = getattr(scheduled, "error", None)
    text = raw.strip() if isinstance(raw, str) else ""
    if text:
        return text
    event_id = str(getattr(scheduled, "event_id", "") or "")
    if not event_id:
        return None
    from app.core.runtime.kernel.constants import EVENT_EXECUTE_COMPLETED

    events = kernel().read_events(
        type=EVENT_EXECUTE_COMPLETED,
        aggregate_type="action",
        aggregate_id=f"exec_{item_id}",
        order="desc",
    )
    matched = next(
        (event for event in events if getattr(event, "caused_by", None) == event_id),
        None,
    )
    if matched is None:
        return None
    payload = matched.payload if isinstance(getattr(matched, "payload", None), dict) else {}
    completed = payload.get("error")
    if not isinstance(completed, str):
        return None
    return completed.strip() or None
