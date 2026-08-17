"""InboxPollRequested handler — poll unread inbox under capability governance.

Product supplies the payload applier via ``bind_inbox_poll_applier`` (stored on
``RuntimeContainer``) so this Runtime handler never imports ``app.product`` (R1)
and reloads of this module do not drop the bind.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from app.core.runtime.handler_registry import subscribe
from app.core.runtime.runtime_container import runtime

if TYPE_CHECKING:
    from app.core.runtime.execution import ExecutionContext
    from app.core.runtime.kernel.event import Event

logger = logging.getLogger(__name__)


def _fail_poll(ctx: "ExecutionContext", event: "Event", error: str) -> None:
    from app.core.runtime.read_ports.inbox import poll_error_kind

    logger.warning("Inbox poll failed: %s", error)
    ctx.emit(
        "InboxPollCompleted", "inbox", f"inbox_{event.aggregate_id}",
        payload={
            "status": "error",
            "error": error,
            "error_kind": poll_error_kind(error),
            "new_count": 0,
        },
        caused_by=event.id,
    )


@subscribe("InboxPollRequested")
async def on_inbox_poll_requested(ctx: "ExecutionContext", event: "Event") -> None:
    """Poll unread inbox via Scheduler under capability governance."""
    from app.core.runtime.kernel_instance import kernel

    apply = runtime.inbox_poll_applier
    if apply is None:
        _fail_poll(ctx, event, "inbox poll applier not bound")
        return

    limit = event.payload.get("limit", 20)
    try:
        recent_limit = max(1, min(int(limit), 20))
    except (TypeError, ValueError):
        recent_limit = 20
    cap = await kernel.invoke_capability(
        "check_inbox",
        {"unread_only": False, "limit": recent_limit},
        actor="scheduler",
        execution_id=ctx.execution_id,
        correlation_id=ctx.correlation_id,
    )
    if cap.get("status") != "success":
        raw_error = cap.get("error", "check_inbox failed")
        if "EMAIL_USER" in raw_error or "EMAIL_PASS" in raw_error:
            raw_error = "Email credentials not configured"
        _fail_poll(ctx, event, raw_error)
        return

    result = cap["result"]
    parse_error: str | None = None
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            parse_error = "invalid inbox JSON"
    if parse_error or not isinstance(result, dict):
        _fail_poll(ctx, event, parse_error or "invalid inbox JSON")
        return

    summary = await apply(result, execution_id=ctx.execution_id)
    if summary.get("status") == "error":
        _fail_poll(ctx, event, str(summary.get("error", "inbox poll failed")))
        return

    ctx.emit(
        "InboxPollCompleted", "inbox", f"inbox_{event.aggregate_id}",
        payload={"status": "success", **summary},
        caused_by=event.id,
    )
