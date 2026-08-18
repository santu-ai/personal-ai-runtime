"""ScheduledExecution 持久化读取器——handler_executions 的 Kernel 空间扫描器。

对投影的读路径；写入只经 Execution 投影器响应 Execution* 事件发生。
Scheduler 用这些扫描器在重启后恢复中断的 ScheduledExecutions。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .query_builder import build_where, safe_order

if TYPE_CHECKING:
    from app.core.runtime.scheduled_execution import ScheduledExecution

logger = logging.getLogger(__name__)

STATUS_RUNNING = "running"
STATUS_PENDING = "pending"
STATUS_RETRYING = "retrying"
RECOVERABLE_STATUSES = (STATUS_PENDING, STATUS_RETRYING)

_ORDER_BY_CREATED_ASC = {"asc": "created_at ASC"}
_BASE_SELECT = "SELECT * FROM handler_executions"


def read_scheduled_execution(db: Any, execution_id: str) -> "ScheduledExecution | None":
    """按 id 读取一条 ScheduledExecution（O(1) 投影查询）。"""
    from app.core.runtime.scheduled_execution import ScheduledExecution

    with db.get_db() as conn:
        row = conn.execute(
            f"{_BASE_SELECT} WHERE id = ?",
            (execution_id,),
        ).fetchone()
    if row is None:
        return None
    return ScheduledExecution.from_row(dict(row))


def read_scheduled_executions(
    db: Any,
    status: str | None = None,
    instance_id: str | None = None,
) -> list["ScheduledExecution"]:
    """从 handler_executions 投影读取 ScheduledExecutions。"""
    from app.core.runtime.scheduled_execution import ScheduledExecution

    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if instance_id is not None:
        clauses.append("instance_id = ?")
        params.append(instance_id)
    where = build_where(clauses)
    order_sql = safe_order("asc", _ORDER_BY_CREATED_ASC, default_key="asc")
    with db.get_db() as conn:
        rows = conn.execute(
            f"{_BASE_SELECT}{where}{order_sql}",
            params,
        ).fetchall()
    return [ScheduledExecution.from_row(dict(r)) for r in rows]


def recover_scheduled_executions(
    db: Any,
) -> tuple[list["ScheduledExecution"], list["ScheduledExecution"]]:
    """扫描重启后需要恢复的 ScheduledExecutions。

    返回 ``(running, pending)``。不做任何写入。
    """
    from app.core.runtime.scheduled_execution import ScheduledExecution

    order_sql = safe_order("asc", _ORDER_BY_CREATED_ASC, default_key="asc")

    placeholders = ",".join("?" * len(RECOVERABLE_STATUSES))
    with db.get_db() as conn:
        running_rows = conn.execute(
            f"{_BASE_SELECT} WHERE status = ?{order_sql}",
            (STATUS_RUNNING,),
        ).fetchall()
        pending_rows = conn.execute(
            f"{_BASE_SELECT} WHERE status IN ({placeholders}){order_sql}",
            tuple(RECOVERABLE_STATUSES),
        ).fetchall()
    running = [ScheduledExecution.from_row(dict(r)) for r in running_rows]
    pending = [ScheduledExecution.from_row(dict(r)) for r in pending_rows]
    return running, pending


def count_scheduled_executions_by_status(db: Any) -> dict[str, int]:
    """返回全部 handler_executions 行的 ``{status: count}``。"""
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS c FROM handler_executions GROUP BY status"
        ).fetchall()
    return {str(r["status"]): int(r["c"]) for r in rows}


def list_stale_running_executions(
    db: Any,
    *,
    ttl_seconds: int,
) -> list["ScheduledExecution"]:
    """Return ``running`` rows whose ``started_at`` is older than ``ttl_seconds``.

    Used by RuntimeLoop lease expiry (E-4). Empty ``started_at`` is treated as
    stale so rows that never recorded a start time cannot stick forever.
    """
    from datetime import UTC, datetime, timedelta

    from app.core.runtime.scheduled_execution import ScheduledExecution

    if ttl_seconds <= 0:
        return []
    cutoff = datetime.now(UTC) - timedelta(seconds=int(ttl_seconds))
    order_sql = safe_order("asc", _ORDER_BY_CREATED_ASC, default_key="asc")
    with db.get_db() as conn:
        rows = conn.execute(
            f"{_BASE_SELECT} WHERE status = ?{order_sql}",
            (STATUS_RUNNING,),
        ).fetchall()
    stale: list[ScheduledExecution] = []
    for row in rows:
        item = ScheduledExecution.from_row(dict(row))
        started = (item.started_at or "").strip()
        if not started:
            stale.append(item)
            continue
        try:
            ts = datetime.fromisoformat(started.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=UTC)
        except ValueError:
            stale.append(item)
            continue
        if ts <= cutoff:
            stale.append(item)
    return stale


def list_dead_letter_executions(db: Any) -> list["ScheduledExecution"]:
    """Return rows marked ``dead_letter=1`` (terminal ExecutionFailed)."""
    from app.core.runtime.scheduled_execution import ScheduledExecution

    order_sql = safe_order("asc", _ORDER_BY_CREATED_ASC, default_key="asc")
    with db.get_db() as conn:
        rows = conn.execute(
            f"{_BASE_SELECT} WHERE dead_letter = 1{order_sql}",
        ).fetchall()
    return [ScheduledExecution.from_row(dict(r)) for r in rows]


def expire_stale_running_leases(
    kernel: Any,
    *,
    ttl_seconds: int | None = None,
) -> int:
    """Fail running executions past lease TTL; return count expired (E-4).

    Prefer ``Scheduler.reclaim_stale_leases`` from RuntimeLoop (cancels
    in-flight tasks and re-queues retries). This helper is the durable
    event-only path used by tests / scripts.
    """
    from datetime import UTC, datetime

    from app.config import settings
    from app.core.runtime.execution_events import emit_execution_failed

    ttl = (
        int(ttl_seconds)
        if ttl_seconds is not None
        else int(settings.running_lease_ttl_seconds)
    )
    if ttl <= 0:
        return 0
    stale = list_stale_running_executions(kernel._db, ttl_seconds=ttl)
    now = datetime.now(UTC).isoformat()
    for item in stale:
        item.error = "timeout"
        item.completed_at = now
        if item.status == "running":
            item.transition_to("failed")
        terminal = not item.can_retry()
        emit_execution_failed(
            kernel, item, terminal=terminal, dead_letter=terminal,
        )
    return len(stale)


def replay_dead_letters(kernel: Any, *, limit: int = 50) -> list[str]:
    """Re-queue dead-lettered executions as pending retries (E-3).

    Clears ``dead_letter`` via ExecutionRetried → pending and enqueues
    into the live Scheduler when available. Returns ids that are durable
    pending **and** (when a Scheduler exists) successfully live-queued.
    """
    from app.core.runtime.execution_events import emit_execution_retried

    durable_ids: list[str] = []
    items = list_dead_letter_executions(kernel._db)[: max(0, int(limit))]
    for item in items:
        item.dead_letter = False
        item.error = ""
        if item.status == "failed":
            item.transition_to("retrying")
        emit_execution_retried(
            kernel, item, reason="dead_letter_replay", status="retrying",
        )
        item.transition_to("pending")
        emit_execution_retried(
            kernel, item, reason="dead_letter_replay", status="pending",
        )
        durable_ids.append(item.id)

    if not durable_ids:
        return []

    try:
        from app.core.runtime.agent_scheduler import get_scheduler

        sch = get_scheduler(kernel)
    except Exception:
        logger.exception("replay_dead_letters: scheduler unavailable; durable pending only")
        return durable_ids

    by_id = {i.id: i for i in items}
    live_queued: list[str] = []
    for eid in durable_ids:
        live = by_id.get(eid)
        if live is None:
            continue
        if live._event is None and live.event_id:
            evs = kernel.read_events(id=live.event_id, limit=1)
            if evs:
                live._event = evs[0]
        if sch.requeue_pending(live, force=True):
            live_queued.append(eid)
        else:
            logger.warning(
                "replay_dead_letters: failed to live-queue %s after durable pending",
                eid,
            )
    return live_queued


def cancel_by_correlation_id(
    scheduler: Any,
    correlation_id: str,
    *,
    event_type: str = "ChatRequested",
) -> int:
    """Cancel live and durable executions matching a request correlation id."""
    if not correlation_id:
        return 0
    targets = {
        item.id
        for item in [*scheduler._pending, *(item for item, _task in scheduler._active.values())]
        if item.correlation_id == correlation_id and item.event_type == event_type
    }
    try:
        targets.update(
            item.id
            for status in (STATUS_RUNNING, STATUS_PENDING, STATUS_RETRYING)
            for item in scheduler._kernel.read_scheduled_executions(status=status)
            if item.correlation_id == correlation_id and item.event_type == event_type
        )
    except Exception:
        logger.debug("cancel_by_correlation_id durable scan failed", exc_info=True)
    return sum(1 for execution_id in targets if scheduler.request_cancel(execution_id))
