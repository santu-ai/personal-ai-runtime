"""Timer MCP Server — schedule reminders and notifications."""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

from app.core.harness.mcp_hub import (
    OUTCOME_TOOL_EXECUTION_FAILURE,
    OUTCOME_TOOL_INVALID_RESULT,
    ToolInvokeError,
)

logger = logging.getLogger(__name__)


def _nested_timer_payload(message: str, work_id: str | None) -> dict:
    """Reminder body plus an already-existing work id, when the caller passed one.

    A blank ``work_id`` is omitted. A non-blank value must name a work item
    that already exists; this does not invent an id or copy another key.
    """
    nested: dict = {"message": message}
    if work_id is None:
        return nested
    if not isinstance(work_id, str):
        raise ToolInvokeError(OUTCOME_TOOL_INVALID_RESULT, "work_id must be a string")
    cleaned = work_id.strip()
    if not cleaned:
        return nested
    from app.core.runtime import read_ports

    if not read_ports.query_work_item(cleaned):
        raise ToolInvokeError(OUTCOME_TOOL_INVALID_RESULT, "work_id does not exist")
    nested["work_id"] = cleaned
    return nested


def _writer_set_timer(
    minutes: float = 0,
    hours: float = 0,
    message: str = "时间到！",
    work_id: str | None = None,
) -> str:
    """Tool handler — emit TimerCreated event."""
    try:
        from app.core.runtime.kernel_instance import kernel

        delay_seconds = (hours * 3600) + (minutes * 60)
        if delay_seconds <= 0:
            raise ToolInvokeError(OUTCOME_TOOL_INVALID_RESULT, "delay must be positive")

        fire_at_dt = datetime.now(UTC) + timedelta(seconds=delay_seconds)
        fire_at = fire_at_dt.isoformat().replace("+00:00", "Z")

        timer_id = f"t_{uuid.uuid4().hex[:12]}"
        nested = _nested_timer_payload(message, work_id)

        kernel.emit_event(
            "TimerCreated",
            "timer",
            timer_id,
            payload={
                "handler_name": "reminder",
                "schedule_type": "once",
                "cron_expr": "",
                "fire_at": fire_at,
                "payload": nested,
            },
            actor="user",
        )

        return json.dumps({
            "timer_id": timer_id,
            "fire_at": fire_at,
            "status": "scheduled",
            "message": f"定时器已设置，将在 {fire_at} 触发。",
        }, ensure_ascii=False)
    except ToolInvokeError:
        raise
    except Exception as e:
        logger.exception("set_timer failed")
        raise ToolInvokeError(OUTCOME_TOOL_EXECUTION_FAILURE, str(e)) from e
