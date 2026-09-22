"""Approval 投影读端口。"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.runtime.read_ports._common import kernel

logger = logging.getLogger(__name__)


def query_pending_approval_count() -> int:
    """Count approvals currently waiting for user decision (exact COUNT)."""
    try:
        return kernel().count_state("approvals", status="pending")
    except Exception:
        logger.exception("query_pending_approval_count failed")
        raise


def query_pending_approvals(*, limit: int = 50) -> list[dict[str, Any]]:
    """List pending approvals (Work / Capability deferrals awaiting the user)."""
    return kernel().query_state("approvals", status="pending", limit=limit)


def query_approval(approval_id: str) -> dict[str, Any] | None:
    rows = kernel().query_state("approvals", id=approval_id, limit=1)
    return rows[0] if rows else None


def query_approvals(*, status: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    filters: dict[str, Any] = {"limit": limit}
    if status:
        filters["status"] = status
    return kernel().query_state("approvals", **filters)


def approval_correlation_id(approval_id: str) -> str:
    from app.core.runtime.plan_resume import approval_correlation_id as resolve

    return resolve(approval_id, kernel=kernel())


def load_approval_chat_checkpoint(approval_id: str) -> tuple[str, dict[str, Any] | None]:
    from app.core.runtime.plan_resume import load_chat_checkpoint

    correlation_id = approval_correlation_id(approval_id)
    checkpoint = (
        load_chat_checkpoint(correlation_id, kernel=kernel())
        if correlation_id
        else None
    )
    return correlation_id, checkpoint


def _event_order(event: Any, source_index: int, event_index: int) -> tuple[int, str, int]:
    """Newest-first key. Prefer seq; fall back to timestamp, then source order."""
    seq = getattr(event, "seq", None)
    if seq is not None:
        return (2, f"{int(seq):020d}", 0)
    timestamp = str(getattr(event, "ts", "") or "")
    return (1, timestamp, -(source_index * 1_000_000 + event_index))


def _suggestion_kind(event_type: str, payload: dict[str, Any] | None) -> str:
    """Map one approval decision onto an adoption bucket.

    ``auto_allow`` and ``auto_expired`` are system outcomes, not user choices,
    so they stay out of the adoption rate.
    """
    reason = str((payload or {}).get("reason") or "")
    action = str((payload or {}).get("action") or "")
    # Clarification replies reuse ApprovalGranted/Denied but are not tool-suggestion
    # adoptions. Keep them out of the adoption rate.
    if action == "ask_user" or reason == "user_reply":
        return ""
    if event_type == "ApprovalGranted":
        return "auto_allowed" if reason == "auto_allow" else "adopted"
    if event_type == "ApprovalDenied":
        return "expired" if reason == "auto_expired" else "rejected"
    return ""


def summarize_suggestion_adoption(*, days: int = 7, limit: int = 500) -> dict[str, Any]:
    """User adoption of needs_user suggestions from ApprovalGranted / ApprovalDenied.

    One latest decision per approval id. ``ApproveCompleted`` is not used:
    that command result has ``status``, not ``decision``.
    """
    since_ts = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    granted = kernel().read_events(
        type="ApprovalGranted", since_ts=since_ts, limit=limit, order="desc",
    )
    denied = kernel().read_events(
        type="ApprovalDenied", since_ts=since_ts, limit=limit, order="desc",
    )
    latest: dict[str, tuple[tuple[int, str, int], str]] = {}
    for source_index, (event_type, events) in enumerate(
        (("ApprovalGranted", granted), ("ApprovalDenied", denied)),
    ):
        for event_index, event in enumerate(events):
            aggregate_id = str(getattr(event, "aggregate_id", "") or "")
            kind = _suggestion_kind(event_type, getattr(event, "payload", None))
            if not aggregate_id or not kind:
                continue
            order = _event_order(event, source_index, event_index)
            current = latest.get(aggregate_id)
            if current is None or order > current[0]:
                latest[aggregate_id] = (order, kind)

    counts = {"adopted": 0, "rejected": 0, "expired": 0, "auto_allowed": 0}
    for _, kind in latest.values():
        if kind in counts:
            counts[kind] += 1
    decided = counts["adopted"] + counts["rejected"]
    return {
        "days": days,
        "adopted": counts["adopted"],
        "rejected": counts["rejected"],
        "expired": counts["expired"],
        "auto_allowed": counts["auto_allowed"],
        "decided": decided,
        "adoption_rate": (counts["adopted"] / decided) if decided else None,
        "capped": len(granted) >= limit or len(denied) >= limit,
    }


def combine_adoption(
    suggestions: dict[str, Any], memories: dict[str, Any],
) -> dict[str, Any]:
    """Headline rate: user-accepted tool suggestions plus ratified memories."""
    adopted = int(suggestions.get("adopted") or 0) + int(memories.get("ratified") or 0)
    rejected = int(suggestions.get("rejected") or 0) + int(memories.get("rejected") or 0)
    decided = adopted + rejected
    return {
        "days": int(suggestions.get("days") or memories.get("days") or 0),
        "suggestions": {
            "days": int(suggestions.get("days") or 0),
            "adopted": int(suggestions.get("adopted") or 0),
            "rejected": int(suggestions.get("rejected") or 0),
            "expired": int(suggestions.get("expired") or 0),
            "auto_allowed": int(suggestions.get("auto_allowed") or 0),
            "decided": int(suggestions.get("decided") or 0),
            "adoption_rate": suggestions.get("adoption_rate"),
        },
        "memories": {
            "ratified": int(memories.get("ratified") or 0),
            "rejected": int(memories.get("rejected") or 0),
            "auto_expired": int(memories.get("auto_expired") or 0),
            "proposed_open": int(memories.get("proposed_open") or 0),
            "decided": int(memories.get("decided") or 0),
            "conversion_rate": memories.get("conversion_rate"),
        },
        "adopted": adopted,
        "rejected": rejected,
        "decided": decided,
        "adoption_rate": (adopted / decided) if decided else None,
    }
