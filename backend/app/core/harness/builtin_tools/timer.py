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


def _writer_set_timer(
    minutes: float = 0,
    hours: float = 0,
    message: str = "时间到！",
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

        kernel.emit_event(
            "TimerCreated",
            "timer",
            timer_id,
            payload={
                "handler_name": "reminder",
                "schedule_type": "once",
                "cron_expr": "",
                "fire_at": fire_at,
                "payload": {"message": message},
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
