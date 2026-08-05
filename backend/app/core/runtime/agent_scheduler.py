"""Lane A Scheduler — runs handlers as ScheduledExecution units.

Distinct from cron_registry: this module is the state machine that drives
each ScheduledExecution (pending → running → completed), persisted in
handler_executions for crash recovery.

    Event → fan-out handlers → enqueue(ScheduledExecution) → Handler

One event may produce N ScheduledExecutions (one per registered handler).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from app.core.runtime.execution_events import (
    emit_execution_completed,
    emit_execution_failed,
    emit_execution_requested,
    emit_execution_retried,
    emit_execution_started,
)

# ── Shadow-compare helpers ──

_SHADOW_FIELDS: tuple[str, ...] = (
    "id", "status", "retry_count", "created_at", "started_at", "completed_at",
    "error", "policy_json", "event_seq", "event_id", "handler_name",
    "instance_id", "correlation_id", "dead_letter",
)


def _shadow_compare(kernel, item) -> list[str]:
    """Verify ScheduledExecution.to_row() matches handler_executions projection.

    Opt-in via ``settings.execution_shadow_compare`` (off in production).
    """
    from app.config import settings

    if not settings.execution_shadow_compare:
        return []

    import json

    def _normalize(row: dict) -> dict:
        out = {k: row.get(k) for k in _SHADOW_FIELDS if k in row}
        pj = out.get("policy_json")
        if isinstance(pj, str) and pj:
            out["policy_json"] = json.dumps(json.loads(pj), sort_keys=True)
        for key in ("started_at", "completed_at", "error"):
            if out.get(key) is None:
                out[key] = ""
        return out

    persist = item.to_row()
    # Boundary: use Kernel ABI (O(1) by id), never SELECT handler_executions here.
    projected = kernel.read_scheduled_execution(item.id)
    if projected is None:
        diffs = ["handler_executions row missing after emit_execution_* projection"]
    else:
        exp = _normalize(persist)
        act = _normalize(projected.to_row())
        diffs = [
            f"{k}: persist={exp.get(k)!r} projection={act.get(k)!r}"
            for k in _SHADOW_FIELDS if exp.get(k) != act.get(k)
        ]
    if diffs:
        logger.warning("shadow compare mismatch for %s: %s", item.id, "; ".join(diffs))
    return diffs


if TYPE_CHECKING:
    from .kernel.event import Event
    from .kernel.kernel import Kernel
    from .scheduled_execution import ScheduledExecution

logger = logging.getLogger(__name__)

# Neutral runtime identity (not an Agent concept).
_RUNTIME_INSTANCE_ID = "runtime:primary"

# Durable reject reason when Lane A pending queue is at capacity.
QUEUE_FULL_ERROR = "queue_full"


class SchedulerQueueFull(RuntimeError):
    """Raised when enqueue would exceed ``scheduler_max_pending``."""


def _max_concurrent() -> int:
    from app.config import settings

    return max(1, int(settings.scheduler_max_concurrent))


def _max_pending() -> int:
    from app.config import settings

    return max(1, int(settings.scheduler_max_pending))


class Scheduler:
    """Lane A execution engine for ScheduledExecution units.

    enqueue(event) creates one ScheduledExecution per registered handler
    and enqueues them. The loop picks up pending items, executes handlers
    with timeout, and transitions status.
    """

    def __init__(self, kernel: "Kernel"):
        self._kernel = kernel
        self._running = False
        self._worker_task: asyncio.Task | None = None
        self._pending: list["ScheduledExecution"] = []
        self._tick_interval: float = 0.05
        # In-flight handler tasks keyed by ScheduledExecution.id (for cancel).
        self._active: dict[str, tuple["ScheduledExecution", asyncio.Task]] = {}

        self._recover()

    def _recover(self) -> None:
        """Recover ScheduledExecutions interrupted by a restart."""
        try:
            running, pending = self._kernel.recover_scheduled_executions()
        except Exception:
            return  # Table may not exist on first boot

        recovered = 0
        for item in running:
            item.error = "interrupted"
            item.transition_to("retrying")
            self._emit_verify(
                item,
                lambda it=item: emit_execution_retried(
                    self._kernel, it,
                    reason="interrupted",
                    status="retrying",
                ),
            )
            item.transition_to("pending")
            self._emit_verify(
                item,
                lambda it=item: emit_execution_retried(
                    self._kernel, it,
                    reason="interrupted",
                    status="pending",
                ),
            )
            self._pending.append(item)
            recovered += 1

        self._pending.extend(pending)
        recovered += len(pending)
        if recovered:
            logger.info("Scheduler: recovered %d scheduled execution(s)", recovered)

    # --- lifecycle -------------------------------------------------------

    async def start(self) -> None:
        # Reuse the existing worker task only if it's alive on the *current*
        # event loop.  When the scheduler is restarted after the previous
        # event loop was shut down (e.g. between TestClient requests or
        # across tests), the old _worker_task is a zombie tied to a dead
        # loop — create_task() would raise.  Check both .done() and
        # .get_loop().is_closed() to detect a dead worker and recreate it.
        # The loop check closes ARCHITECTURE_SURVIVAL_REVIEW High #6: a
        # zombie task reported .done()==False on a closed loop, causing
        # start() to short-circuit and submit_command to time out (504).
        if self._worker_task is not None:
            try:
                loop_closed = self._worker_task.get_loop().is_closed()
            except RuntimeError:
                loop_closed = True
            if not self._worker_task.done() and not loop_closed:
                return
        self._running = True
        self._worker_task = asyncio.create_task(self._scheduler_loop())
        logger.info(
            "Scheduler started (max_concurrent=%d, max_pending=%d)",
            _max_concurrent(),
            _max_pending(),
        )

    async def stop(self) -> None:
        self._running = False
        if self._worker_task:
            try:
                self._worker_task.cancel()
            except RuntimeError:
                pass  # Event loop already closed
            try:
                await self._worker_task
            except (asyncio.CancelledError, RuntimeError):
                pass
            self._worker_task = None
        logger.info("Scheduler stopped")

    def _emit_verify(self, item: "ScheduledExecution", emit_fn) -> None:
        """Emit execution event then verify projection matches."""
        emit_fn()
        _shadow_compare(self._kernel, item)

    def _mark_cancelled(
        self,
        item: "ScheduledExecution",
        *,
        clear_flag: bool = False,
        emit_only_if_running: bool = False,
    ) -> None:
        """Stamp cancelled + emit ExecutionFailed(non-DLQ).

        When ``emit_only_if_running`` is True (CancelledError path), only
        transition+emit if status is still ``running`` — durable cancel may
        already have projected ExecutionFailed via request_cancel (D1).
        """
        if clear_flag:
            from app.core.runtime.execution import clear_execution_cancel

            clear_execution_cancel(item.id)
        if emit_only_if_running:
            if item.status == "failed":
                return
            item.error = "cancelled"
            if item.status != "running":
                return
            item.transition_to("failed")
        else:
            item.error = "cancelled"
            if item.status != "failed":
                item.transition_to("failed")
        self._emit_verify(
            item,
            lambda it=item: emit_execution_failed(
                self._kernel, it, terminal=True, dead_letter=False,
            ),
        )

    def _forget_active(self, execution_id: str) -> Callable[[asyncio.Task], None]:
        """Return a done-callback that drops an in-flight task from ``_active``."""

        def _cb(_task: asyncio.Task) -> None:
            self._active.pop(execution_id, None)

        return _cb

    # --- enqueue ---------------------------------------------------------

    def enqueue(
        self,
        instance_id: str,
        actor: str,
        event: "Event",
        *,
        policy=None,
    ) -> list["ScheduledExecution"]:
        """Create one ScheduledExecution per registered handler (fan-out).

        Raises ``SchedulerQueueFull`` when the pending queue cannot accept the
        full fan-out. Rejected units are recorded as
        ``ExecutionFailed(error=queue_full)`` and are not added to ``_pending``.
        """
        from .handler_registry import get_handlers
        from .scheduled_execution import ScheduledExecution, policy_for_event

        handlers = get_handlers(event.type)
        if not handlers:
            return []

        max_pending = _max_pending()
        if len(self._pending) + len(handlers) > max_pending:
            self._reject_enqueue_backpressure(
                handlers,
                instance_id=instance_id,
                actor=actor,
                event=event,
                policy=policy,
            )
            self._unblock_submit_command(event)
            logger.warning(
                "Scheduler backpressure: pending=%d/%d, rejected %s (%d handler(s))",
                len(self._pending),
                max_pending,
                event.type,
                len(handlers),
            )
            raise SchedulerQueueFull(
                f"Scheduler pending queue full "
                f"({len(self._pending)}/{max_pending}); rejected {event.type}"
            )

        items: list[ScheduledExecution] = []
        for handler in handlers:
            item = ScheduledExecution(
                event_seq=int(event.seq) if event.seq else 0,
                event_id=event.id,
                event_type=event.type,
                handler_name=handler.__name__,
                instance_id=instance_id,
                correlation_id=event.correlation_id or "",
                policy=policy if policy is not None else policy_for_event(event.type),
                _event=event,
            )
            self._pending.append(item)
            self._emit_verify(
                item,
                lambda it=item: emit_execution_requested(self._kernel, it, actor),
            )
            logger.debug(
                "Scheduler: enqueued %s → %s (seq=%s)",
                event.type, handler.__name__, item.event_seq,
            )
            items.append(item)
        return items

    def _reject_enqueue_backpressure(
        self,
        handlers,
        *,
        instance_id: str,
        actor: str,
        event: "Event",
        policy=None,
    ) -> list["ScheduledExecution"]:
        """Record durable failed executions without growing ``_pending``."""
        from .scheduled_execution import ScheduledExecution, policy_for_event

        rejected: list[ScheduledExecution] = []
        for handler in handlers:
            item = ScheduledExecution(
                event_seq=int(event.seq) if event.seq else 0,
                event_id=event.id,
                event_type=event.type,
                handler_name=handler.__name__,
                instance_id=instance_id,
                correlation_id=event.correlation_id or "",
                policy=policy if policy is not None else policy_for_event(event.type),
                _event=event,
                error=QUEUE_FULL_ERROR,
            )
            self._emit_verify(
                item,
                lambda it=item: emit_execution_requested(self._kernel, it, actor),
            )
            item.transition_to("failed")
            self._emit_verify(
                item,
                lambda it=item: emit_execution_failed(
                    self._kernel, it, terminal=True, dead_letter=False,
                ),
            )
            rejected.append(item)
        return rejected

    def _unblock_submit_command(self, event: "Event") -> None:
        """Resolve waiting ``submit_command`` so queue_full is not a timeout."""
        from app.core.runtime.kernel.event_dispatch import (
            default_completion_type,
            resolve_pending_command,
        )

        event_type = getattr(event, "type", "") or ""
        if not event_type.endswith("Requested"):
            return
        resolve_pending_command(
            self._kernel,
            correlation_id=getattr(event, "correlation_id", None) or "",
            completion_type=default_completion_type(event_type),
            payload={"status": "error", "error": QUEUE_FULL_ERROR},
            aggregate_type=getattr(event, "aggregate_type", None) or "command",
            aggregate_id=getattr(event, "aggregate_id", None) or "rejected",
            caused_by=getattr(event, "id", None),
        )

    # --- scheduling loop -------------------------------------------------

    async def _scheduler_loop(self) -> None:
        """Main scheduling loop — process pending ScheduledExecutions.

        E-7: fill concurrent slots per tick without awaiting the whole batch.
        A slow ChatRequested (300s) must not block starting other pending items
        once a slot frees.
        """
        while self._running:
            try:
                limit = _max_concurrent()
                while self._pending and len(self._active) < limit:
                    item = self._pending.pop(0)
                    task = asyncio.create_task(self._process_work_item(item))
                    self._active[item.id] = (item, task)
                    task.add_done_callback(self._forget_active(item.id))

                await asyncio.sleep(self._tick_interval)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Scheduler loop error: %s", exc)
                await asyncio.sleep(1.0)

    async def _process_work_item(self, item: "ScheduledExecution") -> None:
        """Process one ScheduledExecution through its state machine."""
        from app.core.runtime.execution import (
            is_execution_cancelled,
        )

        if is_execution_cancelled(item.id):
            self._mark_cancelled(item, clear_flag=True)
            return

        item.transition_to("running")
        self._emit_verify(
            item,
            lambda: emit_execution_started(self._kernel, item),
        )

        try:
            event = getattr(item, '_event', None)
            if event is None and item.event_id:
                # Recovery: _event lost on deserialization. Rehydrate from event_log.
                rehydrated = self._kernel.read_events(id=item.event_id, limit=1)
                if rehydrated:
                    event = rehydrated[0]
            if event is None:
                item.error = "No event attached to ScheduledExecution"
                item.transition_to("failed")
                self._emit_verify(
                    item,
                    lambda: emit_execution_failed(
                        self._kernel, item, terminal=True, dead_letter=True,
                    ),
                )
                return

            await asyncio.wait_for(
                self._execute_handler(item, event),
                timeout=item.policy.timeout_seconds,
            )
            if item.status == "failed":
                return
            if is_execution_cancelled(item.id):
                self._mark_cancelled(item, clear_flag=True)
                return
            item.error = None
            item.transition_to("completed")
            self._emit_verify(
                item,
                lambda: emit_execution_completed(self._kernel, item),
            )
        except asyncio.CancelledError:
            # Durable cancel may already have projected ExecutionFailed in
            # request_cancel (D1); do not double-emit or rewind status.
            self._mark_cancelled(item, clear_flag=True, emit_only_if_running=True)
            raise
        except asyncio.TimeoutError:
            item.error = f"Timeout after {item.policy.timeout_seconds}s"
            await self._maybe_retry(item)
        except Exception as exc:
            item.error = str(exc)
            await self._maybe_retry(item)

    async def _execute_handler(self, item: "ScheduledExecution", event: "Event") -> None:
        """Resolve the named handler for this ScheduledExecution and run it."""
        from .execution import ExecutionContext
        from .handler_registry import get_handler_named

        handler = get_handler_named(item.event_type, item.handler_name)
        if handler is None:
            item.error = f"No handler {item.handler_name!r} for {item.event_type}"
            item.transition_to("failed")
            self._emit_verify(
                item,
                lambda: emit_execution_failed(
                        self._kernel, item, terminal=True, dead_letter=True,
                    ),
            )
            return

        from .execution import identity_resolver

        actor = (
            item.instance_id
            if ":" in item.instance_id
            else f"runtime:{item.instance_id}"
        )
        principal = identity_resolver.resolve(actor, self._kernel)
        ctx = ExecutionContext(
            instance_id=item.instance_id,
            actor=actor,
            correlation_id=item.correlation_id,
            _kernel=self._kernel,
            principal=principal,
            execution_id=item.id,
        )

        from .execution import execution_scope

        with execution_scope(item.id):
            await handler(ctx, event)

    async def _maybe_retry(self, item: "ScheduledExecution") -> None:
        """Retry if within limits, else mark failed."""
        if item.error == "cancelled":
            self._mark_cancelled(item)
            return
        if item.can_retry():
            item.retry_count += 1
            item.transition_to("retrying")
            self._emit_verify(
                item,
                lambda: emit_execution_retried(
                    self._kernel, item, reason=item.error or "", status="retrying",
                ),
            )
            # Re-enqueue after delay (or fail if pending queue is full).
            await asyncio.sleep(item.policy.retry_delay_seconds)
            item.transition_to("pending")
            self._emit_verify(
                item,
                lambda: emit_execution_retried(
                    self._kernel, item, reason=item.error or "", status="pending",
                ),
            )
            if len(self._pending) >= _max_pending():
                item.error = QUEUE_FULL_ERROR
                item.transition_to("failed")
                self._emit_verify(
                    item,
                    lambda: emit_execution_failed(
                        self._kernel, item, terminal=True, dead_letter=False,
                    ),
                )
                logger.warning(
                    "Scheduler: retry dropped for %s (queue full)",
                    item.handler_name,
                )
            else:
                self._pending.append(item)
                logger.info(
                    "Scheduler: retrying %s (attempt %d/%d)",
                    item.handler_name, item.retry_count, item.policy.max_retries,
                )
        else:
            item.transition_to("failed")
            self._emit_verify(
                item,
                lambda: emit_execution_failed(
                    self._kernel, item, terminal=True, dead_letter=True,
                ),
            )
            logger.warning(
                "Scheduler: %s failed after %d retries: %s",
                item.handler_name, item.policy.max_retries, item.error,
            )

    # --- visibility ------------------------------------------------------

    def pending_count(self) -> int:
        return len(self._pending)

    def max_pending(self) -> int:
        return _max_pending()

    def is_queue_full(self) -> bool:
        return len(self._pending) >= _max_pending()

    def request_cancel(self, execution_id: str) -> bool:
        """Request cancel for a ScheduledExecution (pending or in-flight).

        Pending items are removed from the queue and failed as cancelled.
        In-flight asyncio tasks are cancelled; durable ``ExecutionFailed`` is
        emitted **before** ``task.cancel()`` so a process death mid-cancel
        cannot resurrect the row via ``_recover`` (running→pending).
        """
        from app.core.runtime.execution import request_cancel_execution

        if not execution_id:
            return False
        request_cancel_execution(execution_id)
        found = False
        kept: list[ScheduledExecution] = []
        for item in self._pending:
            if item.id == execution_id:
                found = True
                self._mark_cancelled(item)
            else:
                kept.append(item)
        self._pending = kept
        active = self._active.get(execution_id)
        if active is not None:
            item, task = active
            # Durable cancel first (D1): projection must leave recoverable set.
            if item.status in ("running", "pending", "retrying"):
                self._mark_cancelled(item)
            if not task.done():
                found = True
                task.cancel()
        return found

    def reclaim_stale_leases(self, ttl_seconds: float) -> int:
        """Fail ``running`` executions whose lease (started_at) exceeded TTL (E-4).

        Cancels in-flight tasks, emits ``ExecutionFailed(timeout)``, and either
        re-queues (retries remaining) or marks ``dead_letter`` (exhausted).
        Returns the number of reclaimed executions.
        """
        from datetime import UTC, datetime, timedelta

        if ttl_seconds <= 0:
            return 0
        try:
            running = self._kernel.read_scheduled_executions(status="running")
        except Exception:
            logger.exception("Scheduler: failed to scan running executions for lease")
            return 0

        cutoff = datetime.now(UTC) - timedelta(seconds=float(ttl_seconds))
        reclaimed = 0
        for item in running:
            started = item.started_at or ""
            if not started:
                continue
            try:
                started_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
            except ValueError:
                continue
            if started_dt.tzinfo is None:
                started_dt = started_dt.replace(tzinfo=UTC)
            if started_dt > cutoff:
                continue

            # Drop in-flight task first so CancelledError path sees failed status.
            active = self._active.pop(item.id, None)
            if active is not None:
                _it, task = active
                if not task.done():
                    task.cancel()

            # Prefer live object from _active when present (has _event).
            live = active[0] if active is not None else item
            if live.status != "running":
                # Already terminal elsewhere.
                continue
            live.error = "timeout"
            live.transition_to("failed")
            terminal = not live.can_retry()
            self._emit_verify(
                live,
                lambda it=live, term=terminal: emit_execution_failed(
                    self._kernel, it, terminal=term, dead_letter=term,
                ),
            )
            if not terminal:
                live.retry_count += 1
                live.transition_to("retrying")
                self._emit_verify(
                    live,
                    lambda it=live: emit_execution_retried(
                        self._kernel, it, reason="timeout", status="retrying",
                    ),
                )
                live.transition_to("pending")
                self._emit_verify(
                    live,
                    lambda it=live: emit_execution_retried(
                        self._kernel, it, reason="timeout", status="pending",
                    ),
                )
                if len(self._pending) < _max_pending():
                    self._pending.append(live)
                else:
                    live.error = QUEUE_FULL_ERROR
                    live.transition_to("failed")
                    self._emit_verify(
                        live,
                        lambda it=live: emit_execution_failed(
                            self._kernel, it, terminal=True, dead_letter=True,
                        ),
                    )
            reclaimed += 1
            logger.warning(
                "Scheduler: reclaimed stale lease %s (%s) after %ss",
                live.id, live.handler_name, ttl_seconds,
            )
        return reclaimed

    def cancel_executions_for(self, action_id: str) -> int:
        """Cancel pending/in-flight ExecuteRequested handlers for ``action_id``."""
        if not action_id:
            return 0
        targets: list[str] = []
        for item in self._pending:
            event = getattr(item, "_event", None)
            if (
                event is not None
                and getattr(event, "type", None) == "ExecuteRequested"
                and (getattr(event, "payload", None) or {}).get("action_id")
                == action_id
            ):
                targets.append(item.id)
        for item, _task in self._active.values():
            event = getattr(item, "_event", None)
            if (
                event is not None
                and getattr(event, "type", None) == "ExecuteRequested"
                and (getattr(event, "payload", None) or {}).get("action_id")
                == action_id
            ):
                targets.append(item.id)
        return sum(1 for eid in targets if self.request_cancel(eid))

    def requeue_pending(self, item: "ScheduledExecution", *, force: bool = False) -> bool:
        """Append a pending execution to the live queue if not already tracked.

        Used by dead-letter replay. Returns True when the item was enqueued
        or was already pending/active.

        ``force=True`` bypasses ``scheduler_max_pending`` — for operator-driven
        DLQ replay so durable pending rows cannot vanish from the live queue
        until process restart.
        """
        if item is None or not item.id:
            return False
        if item.id in self._active:
            return True
        if any(p.id == item.id for p in self._pending):
            return True
        if not force and len(self._pending) >= _max_pending():
            logger.warning(
                "Scheduler.requeue_pending rejected %s — pending queue full",
                item.id,
            )
            return False
        self._pending.append(item)
        return True

    async def flush(self) -> None:
        """Process ALL pending ScheduledExecutions immediately. For test use only."""
        while self._pending or self._active:
            while self._pending and len(self._active) < _max_concurrent():
                item = self._pending.pop(0)
                task = asyncio.create_task(self._process_work_item(item))
                self._active[item.id] = (item, task)
                task.add_done_callback(self._forget_active(item.id))
            if not self._active:
                break
            await asyncio.gather(
                *[t for _item, t in list(self._active.values())],
                return_exceptions=True,
            )

    def status_counts(self) -> dict[str, int]:
        """Return a snapshot of ScheduledExecution status distribution."""
        try:
            return self._kernel.count_scheduled_executions_by_status()
        except Exception:
            logger.exception("Scheduler: failed to read scheduled execution counts")
            raise


def get_scheduler(kernel: "Kernel") -> Scheduler:
    """Return the container-owned Scheduler (created with ``kernel`` if needed)."""
    from app.core.runtime.runtime_container import runtime

    return runtime.scheduler_for(kernel)


def reset_scheduler() -> None:
    """Reset the scheduler singleton. For test use only."""
    from app.core.runtime.execution import clear_all_cancels
    from app.core.runtime.runtime_container import runtime

    clear_all_cancels()
    runtime._scheduler = None


# ── Agent bootstrap (folded from agent_bootstrap.py) ─────────────────────
# agents.handlers also pulls in runtime.handlers (capability orchestration).
import app.core.agents.handlers  # noqa: E402,F401 — registers @subscribe handlers

_started = False


async def ensure_scheduler(kernel) -> None:
    """Ensure the Scheduler is running and the event dispatcher is registered.

    Routes emitted events to Lane A (ScheduledExecution fan-out).
    """
    global _started
    if _started:
        return

    from app.core.runtime.agent_scheduler import get_scheduler
    from app.core.runtime.handler_registry import get_handlers

    sch = get_scheduler(kernel)
    await sch.start()

    async def _dispatch_to_scheduler(event):
        if not get_handlers(event.type):
            return
        try:
            sch.enqueue(_RUNTIME_INSTANCE_ID, _RUNTIME_INSTANCE_ID, event)
        except SchedulerQueueFull:
            logger.warning(
                "Scheduler backpressure: rejected enqueue for %s",
                getattr(event, "type", "?"),
            )

    kernel.set_async_dispatcher(_dispatch_to_scheduler)
    _started = True


def reset_agent_bootstrap() -> None:
    """Clear the ``_started`` flag so the next ``ensure_scheduler`` re-binds.

    Pairs with ``reset_scheduler`` in ``runtime_container.reset()``. Without
    this, the module-level ``_started`` boolean survives across tests: the
    fresh Kernel has no ``_async_dispatcher`` registered, but
    ``ensure_scheduler`` short-circuits and the Scheduler loop is never
    (re)started on the new event loop. This was the root cause of the
    intermittent 504s in ``test_approval_resolve`` (ARCHITECTURE_SURVIVAL_REVIEW
    High #6).
    """
    global _started
    _started = False
