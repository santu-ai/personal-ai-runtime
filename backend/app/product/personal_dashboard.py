"""Personal Dashboard — pure Runtime ABI product (consistency slice).

This product is the "一致性测试床" — it proves the Runtime can natively host
a product feature without any boundary violations. Every data access goes
through read_ports → Kernel ABI (query_state, read_events, recall).

No SQL. No file system access. No direct ChromaDB access. Zero bypasses.

Widgets:
  - data_sovereignty: total events, memories (self-report/claim), goals, conversations
  - active_goals: active goal count + top 3 by importance
  - recent_events: last 5 system events (what happened)
  - recent_memories: semantic recall of recent memories
  - timer_status: active timer count (Time dimension)
  - governance_status: active policy + grant counts (Governance)
  - execution_trust: pending approvals, failed/retry/dead-letter executions, last result
"""

import logging
from datetime import UTC, datetime, timedelta

from app.core.runtime import read_ports
from app.core.runtime.kernel.constants import EVENT_CHAT_DONE, EVENT_CHAT_TEXT_DELTA
from app.core.runtime.kernel_instance import kernel

logger = logging.getLogger(__name__)

# Maximum items per widget
_MAX_RECENT_EVENTS = 10
_MAX_RECENT_MEMORIES = 5
_MAX_TOP_GOALS = 3


def generate_dashboard() -> dict:
    """Generate a Personal Dashboard using only Kernel ABI via read_ports.

    Widgets run sequentially: SQLite is fine with thread-local connections, but
    Chroma/HNSW (semantic recall) is not safe under concurrent native access
    and has segfaulted CI under ThreadPoolExecutor + TestClient.
    """
    now = datetime.now(UTC)
    seven_days_ago = (now - timedelta(days=7)).isoformat()

    return {
        "generated_at": now.isoformat(),
        "data_sovereignty": _widget_data_sovereignty(),
        "active_goals": _widget_active_goals(),
        "recent_events": _widget_recent_events(seven_days_ago),
        "recent_memories": _widget_recent_memories(),
        "timer_status": _widget_timer_status(),
        "governance_status": _widget_governance_status(),
        "execution_trust": _widget_execution_trust(),
    }


def _widget_data_sovereignty() -> dict:
    """Data sovereignty overview — user's personal data footprint."""
    try:
        table_counts = kernel.table_counts(
            ("conversations", "messages", "memories", "event_log")
        )
    except Exception:
        logger.warning("Dashboard: Failed to fetch table_counts", exc_info=True)
        table_counts = {}

    try:
        goal_total = read_ports.count_goals()
    except Exception:
        logger.warning("Dashboard: Failed to fetch total goals count", exc_info=True)
        goal_total = 0

    try:
        self_report_count = read_ports.count_memories(origin="self_report")
        claim_count = read_ports.count_memories(origin="claim")
    except Exception:
        logger.warning("Dashboard: Failed to fetch memories footprint", exc_info=True)
        self_report_count = 0
        claim_count = 0

    try:
        goals_active = read_ports.count_active_goals()
        goals_completed = read_ports.count_completed_goals()
    except Exception:
        logger.warning("Dashboard: Failed to fetch active/completed goals count", exc_info=True)
        goals_active = 0
        goals_completed = 0

    try:
        # Extractor stores category="fact"; "belief" is a rare manual category.
        # Newest by created_at (order honored by query_memories via safe_order).
        recent = read_ports.query_memories(limit=1, order="created_at_desc")
        last_reflection = recent[0].get("created_at") if recent else None
    except Exception:
        logger.warning("Dashboard: Failed to fetch last reflection", exc_info=True)
        last_reflection = None

    return {
        "total_events": table_counts.get("event_log", 0),
        "total_memories": table_counts.get("memories", 0),
        "memories_self_report": self_report_count,
        "memories_claim": claim_count,
        "total_goals": goal_total,
        "goals_active": goals_active,
        "goals_completed": goals_completed,
        "total_conversations": table_counts.get("conversations", 0),
        "total_messages": table_counts.get("messages", 0),
        "data_location": "本地存储 (SQLite + ChromaDB)",
        "last_belief_reflection": last_reflection,
        "export_supported": True,
    }


def _widget_active_goals() -> dict:
    """Active goals — count + top by importance."""
    try:
        active_count = read_ports.count_active_goals()
        top = read_ports.query_active_goals(limit=_MAX_TOP_GOALS, order="importance_desc")
    except Exception:
        logger.warning("Dashboard: Failed to fetch active goals widget", exc_info=True)
        return {"count": 0, "top": []}

    return {
        "count": active_count,
        "top": [
            {
                "id": g.get("id", ""),
                "title": g.get("title", ""),
                "progress": g.get("progress", 0),
                "importance": g.get("importance", 0),
            }
            for g in top
        ],
    }


def _widget_recent_events(since_ts: str) -> dict:
    """Recent system events — what happened (read_events only)."""
    try:
        all_events = kernel.read_events(since_ts=since_ts, limit=_MAX_RECENT_EVENTS * 5, order="desc")
        interesting = [e for e in all_events if e.type not in {
            EVENT_CHAT_TEXT_DELTA, EVENT_CHAT_DONE,
        }]
        top_events = interesting[:_MAX_RECENT_EVENTS]
        return {
            "count": len(top_events),
            "total_in_window": len(all_events),
            "items": [
                {
                    "seq": e.seq,
                    "type": e.type,
                    "actor": e.actor,
                    "ts": e.ts,
                }
                for e in top_events
            ],
        }
    except Exception:
        logger.warning("Dashboard: Failed to fetch recent events widget", exc_info=True)
        return {"count": 0, "total_in_window": 0, "items": []}


def _widget_recent_memories() -> dict:
    """Approved memories the system may treat as known (claim-filtered recall)."""
    try:
        memories = read_ports.recall_memories_for_context(
            "recent activities goals preferences",
            max_memories=_MAX_RECENT_MEMORIES,
        )
        return {
            "count": len(memories),
            "items": [
                {
                    "content": m.get("content", "")[:200],
                    "category": m.get("category", ""),
                    "confidence": m.get("confidence", 0),
                }
                for m in memories
            ],
        }
    except Exception:
        logger.warning("Dashboard: Failed to fetch recent memories widget", exc_info=True)
        return {"count": 0, "items": []}


def _widget_timer_status() -> dict:
    """Active timers — Time dimension health."""
    try:
        active_count = read_ports.count_active_timers()
        active = read_ports.query_active_timers(limit=5)
    except Exception:
        logger.warning("Dashboard: Failed to fetch timer status widget", exc_info=True)
        return {"active_timers": 0, "items": []}
    return {
        "active_timers": active_count,
        "items": [
            {
                "handler_name": t.get("handler_name", ""),
                "schedule_type": t.get("schedule_type", ""),
                "fire_at": t.get("fire_at", ""),
            }
            for t in active
        ],
    }


def _widget_governance_status() -> dict:
    """Policy status — Governance Runtime health."""
    try:
        active_policies = read_ports.count_active_policies()
    except Exception:
        logger.warning("Dashboard: Failed to fetch governance status widget", exc_info=True)
        active_policies = 0
    return {
        "active_policies": active_policies,
    }


_EXECUTION_TRUST_EMPTY = {
    "by_status": {},
    "pending_approvals": 0,
    "failed": [],
    "retrying": [],
    "dead_letter": [],
    "dead_letter_count": 0,
    "last_completed": None,
    "last_failed": None,
}


def _public_execution(item) -> dict:
    error = getattr(item, "error", None) or None
    if isinstance(error, str) and len(error) > 200:
        error = error[:200]
    return {
        "id": getattr(item, "id", "") or "",
        "status": getattr(item, "status", "") or "",
        "handler_name": getattr(item, "handler_name", "") or "",
        "event_type": getattr(item, "event_type", "") or "",
        "error": error,
        "retry_count": int(getattr(item, "retry_count", 0) or 0),
        "dead_letter": bool(getattr(item, "dead_letter", False)),
        "created_at": getattr(item, "created_at", "") or "",
        "completed_at": getattr(item, "completed_at", None) or None,
        "correlation_id": getattr(item, "correlation_id", "") or "",
    }


def _newest_executions(items, n: int) -> list[dict]:
    """handler_executions are stored created_at ASC; surface newest first."""
    if n <= 0 or not items:
        return []
    return [_public_execution(item) for item in reversed(items[-n:])]


def _widget_execution_trust() -> dict:
    """Lane A execution health — pending / failed / retry / dead-letter / last result."""
    try:
        by_status = kernel.count_scheduled_executions_by_status()
        failed_rows = kernel.read_scheduled_executions(status="failed")
        retrying_rows = kernel.read_scheduled_executions(status="retrying")
        completed_rows = kernel.read_scheduled_executions(status="completed")
        dead_rows = kernel.list_dead_letter_executions()
        pending_approvals = read_ports.query_pending_approval_count()
    except Exception:
        logger.warning("Dashboard: Failed to fetch execution trust widget", exc_info=True)
        return dict(_EXECUTION_TRUST_EMPTY)

    failed = _newest_executions(failed_rows, 5)
    last_completed = _newest_executions(completed_rows, 1)
    last_failed = failed[:1]
    return {
        "by_status": {str(k): int(v) for k, v in (by_status or {}).items()},
        "pending_approvals": int(pending_approvals or 0),
        "failed": failed,
        "retrying": _newest_executions(retrying_rows, 5),
        "dead_letter": _newest_executions(dead_rows, 5),
        "dead_letter_count": len(dead_rows),
        "last_completed": last_completed[0] if last_completed else None,
        "last_failed": last_failed[0] if last_failed else None,
    }
