"""Timer trigger handler — subscribes to TimerFired and runs scheduled product work."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.config import settings
from app.core.runtime.handler_registry import subscribe

if TYPE_CHECKING:
    from app.core.runtime.execution import ExecutionContext
    from app.core.runtime.kernel.event import Event

logger = logging.getLogger(__name__)


async def _call_product(
    handler_name: str,
    payload: dict | None = None,
    timer_id: str | None = None,
) -> None:
    """Dispatch timer handler_name to the appropriate product function."""
    payload = payload or {}
    from datetime import UTC, datetime, timedelta, tzinfo
    from zoneinfo import ZoneInfo
    try:
        tz: tzinfo = ZoneInfo(settings.timezone)
    except Exception:
        tz = UTC

    try:
        if handler_name == "deadline_alert":
            from app.core.runtime import read_ports

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
                    from app.core.runtime import read_ports

                    read_ports.create_notification(
                        "alert",
                        "Deadline 预警",
                        f"目标「{goal['title']}」还有 {days_left} 天截止",
                    )
        elif handler_name == "memory_decay":
            from app.core.runtime.cron_registry import run_memory_decay

            run_memory_decay()
        elif handler_name == "world_model_snapshot":
            from app.core.agents.world_model import world_model

            world_model.refresh_snapshot()
        elif handler_name == "projection_snapshots":
            from app.core.runtime.kernel_instance import kernel

            results = kernel.save_projection_snapshots()
            logger.info("Projection snapshots saved for %d aggregates", len(results))
        elif handler_name == "inbox_poll":
            await _run_inbox_poll()
        elif handler_name == "inbox_digest":
            from app.product.inbox import generate_inbox_digest

            digest = generate_inbox_digest()
            if digest:
                from app.core.runtime.notification_channel import notification_router
                summary = digest.get("summary", "") if isinstance(digest, dict) else str(digest)
                # generate_inbox_digest already persisted via push_notification;
                # only fan out to external/desktop channels here.
                await notification_router.notify(
                    "收件箱摘要", summary[:500],
                    type_="inbox_digest",
                    persist=False,
                )
        elif handler_name == "morning_brief":
            import time

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
        elif handler_name == "reminder":
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
        else:
            logger.warning("Unknown timer handler: %s", handler_name)
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
