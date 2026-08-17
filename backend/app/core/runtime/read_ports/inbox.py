"""收件箱邮件投影读端口。"""

from __future__ import annotations

import logging
from typing import Any

from app.core.runtime.read_ports._common import kernel

logger = logging.getLogger(__name__)


def query_recent_inbox_emails(
    *,
    limit: int = 20,
    order: str = "date_desc",
) -> list[dict[str, Any]]:
    return kernel().query_state(
        "inbox_emails",
        status_not="archived",
        limit=limit,
        order=order,
    )


def search_inbox_emails(query: str, *, limit: int = 30) -> list[dict[str, Any]]:
    return kernel().query_state(
        "inbox_emails",
        search=query,
        limit=limit,
        order="date_desc",
    )


def query_pending_inbox_emails(*, limit: int = 50) -> list[dict[str, Any]]:
    """Pending inbox rows — state gate for email backlog reactions / nudges."""
    return kernel().query_state(
        "inbox_emails", status="pending", limit=limit, order="date_desc",
    )


def count_pending_inbox_emails() -> int:
    """Exact pending inbox COUNT (not capped by list LIMIT)."""
    try:
        return kernel().count_state("inbox_emails", status="pending")
    except Exception:
        logger.exception("count_pending_inbox_emails failed")
        raise


def query_inbox_email(email_id: str) -> dict[str, Any] | None:
    rows = kernel().query_state("inbox_emails", id=email_id, limit=1)
    return rows[0] if rows else None


def poll_error_kind(error: str | None) -> str | None:
    """Map a poll error string to a stable kind for UI (IMAP / JSON / 分类 / …)."""
    if not error:
        return None
    text = error.lower()
    if "email credentials" in text or "email_user" in text or "email_pass" in text:
        return "credentials"
    if "invalid inbox json" in text:
        return "json"
    if "classif" in text or "分类" in text:
        return "classification"
    if "imap" in text or "timeout" in text:
        return "imap"
    return "other"


def query_latest_inbox_poll() -> dict[str, Any] | None:
    """Latest InboxPollCompleted — last sync time / result / failure reason."""
    events = kernel().read_events(type="InboxPollCompleted", limit=1, order="desc")
    if not events:
        return None
    ev = events[0]
    payload = ev.payload or {}
    error = payload.get("error")
    raw_status = payload.get("status")
    status = raw_status or ("error" if error else "ok")
    if status == "success":
        status = "ok"
    kind = payload.get("error_kind") or poll_error_kind(str(error) if error else None)
    return {
        "status": status,
        "error": error,
        "error_kind": kind,
        "new_count": int(payload.get("new_count") or 0),
        "synced_read": int(payload.get("synced_read") or 0),
        "duplicate_count": int(payload.get("duplicate_count") or 0),
        "classification_fallback": int(payload.get("classification_fallback") or 0),
        "synced_at": ev.ts,
        "event_id": ev.id,
    }


def summarize_inbox_sync_metrics(*, days: int = 7, limit: int = 200) -> dict[str, Any]:
    """Counts reconstructed from InboxPoll* events (no new projection)."""
    from datetime import UTC, datetime, timedelta

    since_ts = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    completed = kernel().read_events(
        type="InboxPollCompleted", since_ts=since_ts, limit=limit, order="desc",
    )
    requested = kernel().read_events(
        type="InboxPollRequested", since_ts=since_ts, limit=limit, order="desc",
    )
    error_count = 0
    new_count = 0
    duplicate_count = 0
    synced_read = 0
    classification_fallback = 0
    errors_by_kind: dict[str, int] = {}
    for ev in completed:
        payload = ev.payload or {}
        status = payload.get("status")
        error = payload.get("error")
        if status == "error" or error:
            error_count += 1
            kind = payload.get("error_kind") or poll_error_kind(str(error) if error else None) or "other"
            errors_by_kind[kind] = errors_by_kind.get(kind, 0) + 1
        new_count += int(payload.get("new_count") or 0)
        duplicate_count += int(payload.get("duplicate_count") or 0)
        synced_read += int(payload.get("synced_read") or 0)
        classification_fallback += int(payload.get("classification_fallback") or 0)

    rapid_repeat_polls = 0
    prev_ts: str | None = None
    for ev in sorted(requested, key=lambda e: e.ts or ""):
        if prev_ts:
            try:
                delta = (
                    datetime.fromisoformat(ev.ts) - datetime.fromisoformat(prev_ts)
                ).total_seconds()
            except (TypeError, ValueError):
                delta = 999
            if 0 <= delta < 60:
                rapid_repeat_polls += 1
        prev_ts = ev.ts

    return {
        "days": days,
        "poll_count": len(completed),
        "requested_count": len(requested),
        "error_count": error_count,
        "errors_by_kind": errors_by_kind,
        "new_count": new_count,
        "duplicate_count": duplicate_count,
        "synced_read": synced_read,
        "classification_fallback": classification_fallback,
        "rapid_repeat_polls": rapid_repeat_polls,
    }


def query_inbox_emails(
    *,
    category: str | None = None,
    status: str | None = None,
    digested: int | None = None,
    limit: int = 50,
    order: str = "date_desc",
) -> list[dict[str, Any]]:
    """Flexible inbox projection reader used by product/inbox and APIs."""
    filters: dict[str, Any] = {"limit": limit, "order": order}
    if category:
        filters["category"] = category
    if status and status != "all":
        filters["status"] = status
    if digested is not None:
        filters["digested"] = digested
    return kernel().query_state("inbox_emails", **filters)

