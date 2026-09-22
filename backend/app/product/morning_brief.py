"""Morning brief — daily summary of goals, inbox, and today's calendar.

Extracted from the timer handler so the same path can be invoked by the
08:00 cron and by the diagnostic ``POST /api/system/morning-brief/test``.
"""

from __future__ import annotations

import logging
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, tzinfo
from typing import Any
from zoneinfo import ZoneInfo

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class MorningBriefResult:
    """Brief text plus per-step diagnostics for observability."""

    brief: str
    goals_count: int = 0
    inbox_count: int = 0
    mailbox_count: int = 0
    calendar_count: int = 0
    proposed_count: int = 0
    steps_ms: dict[str, float] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    date_local: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def notification_title(date_local: str) -> str:
    """In-app title. Date-scoped so type+title idempotency does not collapse days."""
    return f"早安简报 - {date_local}"


def notification_dedup_key(date_local: str) -> str:
    """Same-day retries collapse; a new local date creates a new notification."""
    return f"morning_brief:{date_local}"


def _resolve_tz() -> tzinfo:
    try:
        return ZoneInfo(settings.timezone)
    except Exception:
        return UTC


def _format_progress(raw: object) -> str:
    """将 work_item.progress（规范存储为 0-1 浮点）转成百分比文本。

    兼容历史数据里可能存在的 0-100 整数形态：<=1 按比例放大，>1 视为已是百分数。
    """
    if raw is None or raw == "":
        return "0"
    try:
        if isinstance(raw, (int, float)):
            value = float(raw)
        else:
            value = float(str(raw).strip())
    except (TypeError, ValueError):
        return "0"
    pct = int(round(value * 100)) if value <= 1.0 else int(round(value))
    return str(max(0, min(100, pct)))


def _as_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return int(value)


def _format_count_delta(delta: int) -> str:
    if delta > 0:
        return f"+{delta}"
    if delta < 0:
        return str(delta)
    return "持平"


def _format_percent(value: object) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "—"
    return f"{round(float(value) * 100)}%"


def _format_rate_delta(value: object) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "—"
    points = round(float(value) * 100)
    if points > 0:
        return f"+{points} 个百分点"
    if points < 0:
        return f"{points} 个百分点"
    return "持平"


def _format_period_comparison(comparison: object) -> str:
    """User-visible lines for the same window ``compare_periods`` returns."""
    if not isinstance(comparison, dict):
        raise TypeError("period comparison is not a mapping")
    signals = comparison.get("signals")
    if not isinstance(signals, dict):
        raise TypeError("period comparison has no signals")
    days = _as_int(comparison.get("days")) or 7

    def count_line(label: str, key: str) -> str:
        signal = signals.get(key)
        if not isinstance(signal, dict):
            signal = {}
        current = _as_int(signal.get("current"))
        delta = _as_int(signal.get("delta"))
        return f"  · {label} {current}（{_format_count_delta(delta)}）"

    lines = [f"📊 近 {days} 日 vs 前 {days} 日:"]
    lines.append(count_line("完成目标", "goals_completed"))
    lines.append(count_line("完成任务", "tasks_completed"))
    untyped = signals.get("work_completed_untyped")
    if isinstance(untyped, dict) and (
        _as_int(untyped.get("current")) or _as_int(untyped.get("previous"))
    ):
        lines.append(count_line("已完成（类型未知）", "work_completed_untyped"))
    lines.append(count_line("新邮件", "inbox_recorded"))
    rate = signals.get("adoption_rate")
    if not isinstance(rate, dict):
        rate = {}
    lines.append(
        f"  · 采纳率 {_format_percent(rate.get('current'))}"
        f"（{_format_rate_delta(rate.get('delta'))}）"
    )
    if comparison.get("capped"):
        lines.append("  这段时间事件较多，数字可能不完整")
    return "\n".join(lines)


def _period_comparison_block(read_ports: Any, result: MorningBriefResult) -> str:
    """Same read as the today card. A failed read degrades this section only."""
    t0 = time.perf_counter()
    try:
        text = _format_period_comparison(read_ports.compare_periods(days=7))
        logger.info(
            "morning_brief: periods ok",
            extra={"step": "periods"},
        )
    except Exception as exc:
        text = "📊 近 7 日 vs 前 7 日:\n  获取失败"
        result.errors.append(f"periods: {type(exc).__name__}: {exc}")
        logger.warning(
            "morning_brief: periods failed: %s",
            exc,
            extra={"step": "periods", "error": str(exc)},
        )
    result.steps_ms["periods"] = round((time.perf_counter() - t0) * 1000, 1)
    return text


def generate_morning_brief() -> MorningBriefResult:
    """Assemble the morning brief text. Does not persist or notify.

    Each read-port call is timed and wrapped so a single failing source
    degrades the brief instead of aborting the whole generation.
    """
    from app.core.runtime import read_ports

    result = MorningBriefResult(brief="")
    tz = _resolve_tz()
    now_local = datetime.now(tz)
    result.date_local = now_local.strftime("%Y-%m-%d")

    logger.info(
        "morning_brief: start",
        extra={"step": "start", "date_local": result.date_local},
    )

    # Today's calendar events (not active timers — see dogfood Day 3).
    t0 = time.perf_counter()
    calendar_count = 0
    try:
        calendar_data = read_ports.query_calendar_today_events()
        events = calendar_data.get("events") if isinstance(calendar_data, dict) else None
        if isinstance(events, list):
            calendar_count = len(events)
        elif isinstance(calendar_data, dict):
            calendar_count = int(calendar_data.get("count") or 0)
        result.calendar_count = calendar_count
        logger.info(
            "morning_brief: calendar ok count=%d",
            calendar_count,
            extra={"step": "calendar", "count": calendar_count},
        )
    except Exception as exc:
        result.errors.append(f"calendar: {type(exc).__name__}: {exc}")
        logger.warning(
            "morning_brief: calendar failed: %s",
            exc,
            extra={"step": "calendar", "error": str(exc)},
        )
    result.steps_ms["calendar"] = round((time.perf_counter() - t0) * 1000, 1)

    # Active goals
    t0 = time.perf_counter()
    goal_lines = "  无"
    try:
        active_goals = read_ports.query_active_goals(limit=10)
        result.goals_count = len(active_goals) if active_goals else 0
        if active_goals:
            goal_lines = "\n".join(
                f"  · {g.get('title', '')} (进度 {_format_progress(g.get('progress'))}%)"
                for g in active_goals[:5]
            )
        logger.info(
            "morning_brief: goals ok count=%d",
            result.goals_count,
            extra={"step": "goals", "count": result.goals_count},
        )
    except Exception as exc:
        goal_lines = "  获取失败"
        result.errors.append(f"goals: {type(exc).__name__}: {exc}")
        logger.warning(
            "morning_brief: goals failed: %s",
            exc,
            extra={"step": "goals", "error": str(exc)},
        )
    result.steps_ms["goals"] = round((time.perf_counter() - t0) * 1000, 1)

    # Inbox: pending = 未读; mailbox_count = 已同步封数（含已读）。
    t0 = time.perf_counter()
    try:
        result.inbox_count = int(read_ports.count_pending_inbox_emails() or 0)
        result.mailbox_count = int(read_ports.count_inbox_emails() or 0)
        logger.info(
            "morning_brief: inbox ok pending=%d mailbox=%d",
            result.inbox_count,
            result.mailbox_count,
            extra={
                "step": "inbox",
                "count": result.inbox_count,
                "mailbox": result.mailbox_count,
            },
        )
    except Exception as exc:
        result.errors.append(f"inbox: {type(exc).__name__}: {exc}")
        logger.warning(
            "morning_brief: inbox failed: %s",
            exc,
            extra={"step": "inbox", "error": str(exc)},
        )
    result.steps_ms["inbox"] = round((time.perf_counter() - t0) * 1000, 1)

    # Proposed memories: count + review link only (do not dump noisy snippets).
    t0 = time.perf_counter()
    proposed_lines = "  无"
    try:
        result.proposed_count = int(
            read_ports.count_memories(claim_status="proposed") or 0
        )
        if result.proposed_count:
            proposed_lines = "  打开 /memories?tab=review 批量确认后才会进入对话"
        logger.info(
            "morning_brief: proposed_memories ok count=%d",
            result.proposed_count,
            extra={"step": "proposed_memories", "count": result.proposed_count},
        )
    except Exception as exc:
        proposed_lines = "  获取失败"
        result.errors.append(f"proposed_memories: {type(exc).__name__}: {exc}")
        logger.warning(
            "morning_brief: proposed_memories failed: %s",
            exc,
            extra={"step": "proposed_memories", "error": str(exc)},
        )
    result.steps_ms["proposed_memories"] = round((time.perf_counter() - t0) * 1000, 1)

    period_block = _period_comparison_block(read_ports, result)
    result.brief = (
        f"早安！{now_local.strftime('%Y年%m月%d日')} 简报\n\n"
        f"📋 进行中的目标:\n{goal_lines}\n\n"
        f"📧 收件箱: {result.mailbox_count} 封（未读 {result.inbox_count}）\n\n"
        f"📅 今日日程: {result.calendar_count} 个\n\n"
        f"🧠 待确认记忆: {result.proposed_count} 条\n{proposed_lines}\n\n"
        f"{period_block}\n\n"
        f"祝你今天一切顺利！"
    )

    logger.info(
        "morning_brief: assembled goals=%d inbox=%d mailbox=%d calendar=%d proposed=%d errors=%d",
        result.goals_count,
        result.inbox_count,
        result.mailbox_count,
        result.calendar_count,
        result.proposed_count,
        len(result.errors),
        extra={"step": "assembled", "errors": result.errors},
    )
    return result
