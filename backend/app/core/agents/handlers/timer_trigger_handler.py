"""Timer trigger handler — subscribes to TimerFired and runs scheduled product work."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta, tzinfo
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from app.config import settings
from app.core.runtime.handler_registry import subscribe

if TYPE_CHECKING:
    from app.core.runtime.execution import ExecutionContext
    from app.core.runtime.kernel.event import Event

logger = logging.getLogger(__name__)

TimerHandler = Callable[[dict, str | None], Awaitable[None] | None]


def _local_tz() -> tzinfo:
    try:
        return ZoneInfo(settings.timezone)
    except Exception:
        return UTC


def _handle_deadline_alert(payload: dict, timer_id: str | None) -> None:
    del payload, timer_id
    from app.core.runtime import read_ports

    tz = _local_tz()
    candidates = read_ports.query_goals_with_deadline(limit=500)
    now_local = datetime.now(tz)
    today = now_local.date()
    target_dates = {today + timedelta(days=offset) for offset in (1, 3)}
    for goal in candidates:
        if not goal.get("deadline"):
            continue
        try:
            deadline_dt = datetime.fromisoformat(goal["deadline"])
            if deadline_dt.tzinfo is None:
                deadline_dt = deadline_dt.replace(tzinfo=UTC)
            deadline_local = deadline_dt.astimezone(tz)
            deadline_date = deadline_local.date()
        except ValueError:
            continue
        if deadline_date in target_dates:
            days_left = (deadline_local.date() - today).days
            read_ports.create_notification(
                "alert",
                "Deadline 预警",
                f"目标「{goal['title']}」还有 {days_left} 天截止",
            )


def _handle_memory_decay(payload: dict, timer_id: str | None) -> None:
    del payload, timer_id
    from app.core.runtime.cron_registry import run_memory_decay

    run_memory_decay()


def _handle_world_model_snapshot(payload: dict, timer_id: str | None) -> None:
    del payload, timer_id
    from app.core.agents.world_model import world_model

    world_model.refresh_snapshot()


def _handle_projection_snapshots(payload: dict, timer_id: str | None) -> None:
    del payload, timer_id
    from app.core.runtime.kernel_instance import kernel

    results = kernel.save_projection_snapshots()
    logger.info("Projection snapshots saved for %d aggregates", len(results))


async def _handle_inbox_poll(payload: dict, timer_id: str | None) -> None:
    del payload, timer_id
    await _run_inbox_poll()


async def _handle_inbox_digest(payload: dict, timer_id: str | None) -> None:
    del payload, timer_id
    from app.core.runtime.notification_channel import notification_router
    from app.product.inbox import generate_inbox_digest

    digest = generate_inbox_digest()
    if digest:
        summary = digest.get("summary", "") if isinstance(digest, dict) else str(digest)
        # generate_inbox_digest already persisted via push_notification;
        # only fan out to external/desktop channels here.
        await notification_router.notify(
            "收件箱摘要", summary[:500],
            type_="inbox_digest",
            persist=False,
        )


async def _handle_morning_brief(payload: dict, timer_id: str | None) -> None:
    del payload
    from app.core.runtime.notification_channel import notification_router
    from app.product.morning_brief import generate_morning_brief

    logger.info(
        "morning_brief: timer fired timer_id=%s",
        timer_id,
        extra={"step": "timer_fired", "timer_id": timer_id},
    )
    result = generate_morning_brief()
    t0 = time.perf_counter()
    logger.info(
        "morning_brief: notify start persist=True",
        extra={"step": "notify_start", "persist": True},
    )
    await notification_router.notify(
        "早安简报",
        result.brief,
        type_="morning_brief",
        priority="normal",
        persist=True,
    )
    logger.info(
        "morning_brief: notify done ms=%.1f",
        (time.perf_counter() - t0) * 1000,
        extra={"step": "notify_done"},
    )


async def _handle_reminder(payload: dict, timer_id: str | None) -> None:
    from app.core.runtime.notification_channel import notification_router

    message = payload.get("message", "时间到！")
    title = f"提醒: {message}" if len(message) < 20 else "提醒"
    # Include timer_id so create_notification idempotency doesn't collapse
    # consecutive reminders with the same message text.
    if timer_id:
        title = f"{title} ({timer_id})"

    await notification_router.notify(
        title, message, type_="reminder", priority="high", persist=True,
    )


# Strong refs so fire-and-forget url_monitor tasks are not GC'd mid-flight.
_url_monitor_tasks: set[asyncio.Task] = set()


async def _run_url_monitors_bg() -> None:
    from app.product.url_monitors import evaluate_url_monitors

    try:
        notified = await evaluate_url_monitors(force=False)
        if notified:
            logger.info("url_monitor notified %d change(s)", notified)
    except Exception:
        logger.warning("url_monitor background run failed", exc_info=True)


async def _handle_url_monitor(payload: dict, timer_id: str | None) -> None:
    """Schedule URL checks off the TimerFired WorkItem (30s ExecutionPolicy).

    Same rationale as inbox_poll: fetch I/O must not nest under the timer
    handler timeout. Cap per tick lives inside ``evaluate_url_monitors``.
    """
    del payload, timer_id
    task = asyncio.create_task(_run_url_monitors_bg(), name="url_monitor_eval")
    _url_monitor_tasks.add(task)
    task.add_done_callback(_url_monitor_tasks.discard)


_TIMER_HANDLERS: dict[str, TimerHandler] = {
    "deadline_alert": _handle_deadline_alert,
    "memory_decay": _handle_memory_decay,
    "world_model_snapshot": _handle_world_model_snapshot,
    "projection_snapshots": _handle_projection_snapshots,
    "inbox_poll": _handle_inbox_poll,
    "inbox_digest": _handle_inbox_digest,
    "morning_brief": _handle_morning_brief,
    "reminder": _handle_reminder,
    "url_monitor": _handle_url_monitor,
}


async def _call_product(
    handler_name: str,
    payload: dict | None = None,
    timer_id: str | None = None,
) -> None:
    """Dispatch timer handler_name to the appropriate product function."""
    payload = payload or {}
    handler = _TIMER_HANDLERS.get(handler_name)
    if handler is None:
        logger.warning("Unknown timer handler: %s", handler_name)
        return

    try:
        result = handler(payload, timer_id)
        if result is not None:
            await result
    except Exception as e:
        logger.warning("Timer handler %s error: %s", handler_name, e)
        if handler_name == "morning_brief":
            try:
                from app.core.runtime.notification_channel import notification_router

                await notification_router.notify(
                    "早安简报生成失败",
                    f"定时触发失败: {type(e).__name__}: {e}",
                    type_="morning_brief_failed",
                    priority="high",
                    persist=True,
                )
            except Exception as notify_exc:
                logger.warning(
                    "morning_brief: failed to push failure alert: %s", notify_exc
                )


async def _run_inbox_poll():
    """Inbox poll via fire-and-forget event emission.

    Emits InboxPollRequested without waiting for completion — the handler
    runs as its own WorkItem and reports back via InboxPollCompleted. This
    keeps the TimerFired WorkItem under its 30s timeout instead of nesting
    a synchronous submit_command that can never finish in time.
    """
    import uuid

    from app.core.runtime.agent_scheduler import ensure_scheduler, get_scheduler
    from app.core.runtime.kernel_instance import kernel

    await ensure_scheduler(kernel)
    sched = get_scheduler(kernel)
    await sched.start()
    kernel.emit_event(
        "InboxPollRequested",
        "inbox",
        f"inbox_poll_{uuid.uuid4().hex[:8]}",
        payload={"limit": 20},
        actor="scheduler",
    )


@subscribe("TimerFired")
async def on_timer_fired(ctx: "ExecutionContext", event: "Event") -> None:
    """TimerFired → execute product function in Execution context."""
    handler_name = event.payload.get("handler_name", "")
    payload = event.payload.get("payload", {})
    timer_id = event.aggregate_id
    if not handler_name:
        logger.warning("TimerFired without handler_name: %s", event.id)
        return
    await _call_product(handler_name, payload, timer_id)
