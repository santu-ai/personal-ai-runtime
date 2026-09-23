"""Cron 调度——经 Runtime Timer Engine 的定时任务调度。

``ensure_schedules`` 内联在 RuntimeLoop 中。``init_scheduler`` 播种
TimerCreated 行与依赖触发器；``shutdown_scheduler`` 移除这些事件订阅
（定时扫描本身留在 RuntimeLoop）。
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Callable

from app.config import settings
from app.core.runtime import read_ports
from app.core.runtime.kernel_instance import kernel
from app.core.runtime.runtime_loop import RuntimeLoop

logger = logging.getLogger(__name__)

SCHEDULES: list[dict] = [
    {"name": "morning_brief", "cron_expr": "hour=8,minute=0", "schedule_type": "cron", "handler_name": "morning_brief"},
    {"name": "deadline_alert", "cron_expr": "hour=9,minute=0", "schedule_type": "cron", "handler_name": "deadline_alert"},
    {"name": "memory_decay", "cron_expr": "hour=3,minute=0", "schedule_type": "cron", "handler_name": "memory_decay"},
    {"name": "world_model_snapshot", "cron_expr": "day_of_week=sun,hour=6,minute=0", "schedule_type": "cron", "handler_name": "world_model_snapshot"},
    {"name": "projection_snapshots", "cron_expr": "hour=4,minute=0", "schedule_type": "cron", "handler_name": "projection_snapshots"},
    {"name": "inbox_poll", "cron_expr": "minute=*/15", "schedule_type": "cron", "handler_name": "inbox_poll"},
    {"name": "inbox_digest", "cron_expr": "hour=8,minute=30", "schedule_type": "cron", "handler_name": "inbox_digest"},
    {"name": "url_monitor", "cron_expr": "minute=*/30", "schedule_type": "cron", "handler_name": "url_monitor"},
    {"name": "telegram_poll", "cron_expr": "minute=*/1", "schedule_type": "cron", "handler_name": "telegram_poll"},
]

_unsubscribe_hooks: list[Callable[[], None]] = []


def init_scheduler():
    """注册定时任务与依赖触发器。"""
    shutdown_scheduler()  # 幂等重初始化
    _unsubscribe_hooks.append(
        kernel.subscribe_events(_on_work_item_status_changed, type="WorkItemStatusChanged")
    )
    _init_timers()


def _init_timers():
    """为所有定时 cron 任务注册 TimerCreated 事件。"""
    for sched in SCHEDULES:
        name = sched["name"]
        existing = read_ports.query_timer(name)
        if existing and existing.get("status") == "active":
            continue
        cron_expr = sched.get("cron_expr", "")
        next_fire = RuntimeLoop._next_cron_fire(cron_expr)
        kernel.emit_event(
            "TimerCreated", "timer", name,
            payload={
                "handler_name": sched.get("handler_name", ""),
                "schedule_type": sched.get("schedule_type", "cron"),
                "cron_expr": cron_expr,
                "fire_at": next_fire,
            },
            actor="system",
        )


def _dependency_ids(item: dict) -> set[str]:
    """Ids listed in ``dependencies_json``. Empty when the row has no deps."""
    raw = item.get("dependencies_json")
    if not isinstance(raw, str) or not raw.strip():
        return set()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {dep for dep in parsed if isinstance(dep, str) and dep}


def _on_work_item_status_changed(event):
    """启动把刚结束的这项写进依赖、且依赖都已完成的后继。

    没有依赖的待执行任务不会被别人的完成拉起。``rerun_restore`` 只是把
    再次运行失败的简报收回 ``completed``，不是新的完成。
    """
    if getattr(event, "type", None) != "WorkItemStatusChanged":
        return
    payload = event.payload if isinstance(event.payload, dict) else {}
    status = payload.get("status")
    if status not in ("completed", "failed"):
        return
    if payload.get("reason") == read_ports.WORK_STATUS_REASON_RERUN_RESTORE:
        return
    changed_id = str(getattr(event, "aggregate_id", "") or "")
    if not changed_id:
        return

    from app.core.runtime.work_item_engine import are_dependencies_met

    rows = read_ports.query_pending_work_items(limit=100)
    for item in rows:
        if changed_id not in _dependency_ids(item):
            continue
        if are_dependencies_met(item["id"]):
            kernel.emit_event(
                "WorkItemStatusChanged", "work_item", item["id"],
                payload={"status": "running"}, actor="system",
            )


def _deadline_target_dates() -> set:
    """返回触发 deadline 提醒的日期集合（本地时区）。"""
    from datetime import tzinfo
    from zoneinfo import ZoneInfo
    try:
        tz: tzinfo = ZoneInfo(settings.timezone)
    except Exception:
        tz = UTC
    today = datetime.now(tz).date()
    return {today + timedelta(days=offset) for offset in (1, 3)}


def shutdown_scheduler() -> None:
    """注销 ``init_scheduler`` 注册的 cron 依赖触发器。

    定时扫描本身仍归 RuntimeLoop；这里只清除 WorkItemStatusChanged
    订阅，避免测试与进程关闭在 Kernel 重置后泄漏 handler。
    """
    while _unsubscribe_hooks:
        unsub = _unsubscribe_hooks.pop()
        try:
            unsub()
        except Exception:
            logger.debug("cron unsubscribe failed", exc_info=True)


def run_memory_decay(threshold: float = 0.3, decay_to: float = 0.1) -> int:
    """为陈旧低置信度记忆发出 MemoryDecayed（每日 cron）。"""
    count = 0
    candidates = read_ports.query_memories(
        confidence_gt=decay_to,
        confidence_lt=0.8,
        decay_eligible=True,
        limit=50,
    )
    for mem in candidates:
        if mem["confidence"] <= threshold:
            new_conf = max(decay_to, mem["confidence"] - 0.1)
            kernel.emit_event(
                type="MemoryDecayed",
                aggregate_type="memory",
                aggregate_id=mem["id"],
                payload={"confidence": new_conf},
                actor="scheduler",
            )
            count += 1
    return count


def expire_proposed_memories(*, now: datetime | None = None) -> int:
    """Auto-reject proposed claims older than the configured review TTL."""
    ttl_days = max(int(settings.proposed_memory_ttl_days), 0)
    if ttl_days == 0:
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=ttl_days)
    candidates = read_ports.query_memories(
        origin="claim",
        claim_status="proposed",
        created_at_lte=cutoff.isoformat(),
        order="created_at_asc",
        limit=5000,
    )
    for memory in candidates:
        kernel.emit_event(
            type="ClaimRejected",
            aggregate_type="memory",
            aggregate_id=memory["id"],
            payload={"reason": "auto_expired", "by": "scheduler"},
            actor="scheduler",
        )
    return len(candidates)
