"""Notifications API — list, mark as read, and get notifications."""

from fastapi import APIRouter, HTTPException, Query

from app.core.runtime import read_ports
from app.core.runtime.kernel.constants import (
    AGGREGATE_NOTIFICATION,
    EVENT_NOTIFICATION_READ,
)
from app.core.runtime.kernel_instance import kernel

router = APIRouter(tags=["notifications"])


@router.get("/")
async def list_notifications(unread_only: bool = False, limit: int = Query(50, ge=1, le=500)):
    """List notifications, optionally filtered to unread only."""
    rows = read_ports.query_notifications(unread_only=unread_only, limit=limit)
    return [dict(r) for r in rows]


@router.get("/unread-count")
async def unread_count():
    """Get count of unread notifications."""
    return {"count": read_ports.query_unread_notification_count()}


@router.put("/read-all")
async def mark_all_as_read():
    """Mark all notifications as read."""
    _emit_read_event("all")
    return {"status": "ok"}


def _emit_read_event(notification_id: str) -> None:
    """发一条 NotificationRead 事件。

    单条已读与全部已读共用此路径；``notification_id="all"`` 是批量语义，
    由 projectors_core 的 NotificationRead 投影器解释。
    """
    kernel.emit_event(
        EVENT_NOTIFICATION_READ,
        AGGREGATE_NOTIFICATION,
        notification_id,
        payload={},
        actor="user",
    )


@router.put("/{notification_id}/read")
async def mark_as_read(notification_id: str):
    """Mark a notification as read."""
    existing = read_ports.query_notification(notification_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Notification not found")
    _emit_read_event(notification_id)
    return {"status": "ok"}
