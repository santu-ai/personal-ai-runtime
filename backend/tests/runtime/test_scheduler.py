"""Tests for cron_registry — timer registration and event dispatch."""

import pytest

EXPECTED_SCHEDULE_NAMES = {
    "deadline_alert",
    "memory_decay",
    "world_model_snapshot",
    "projection_snapshots",
    "inbox_poll",
    "inbox_digest",
    "morning_brief",
}


def test_schedules_has_all_timers():
    from app.core.runtime.cron_registry import SCHEDULES

    names = {s["name"] for s in SCHEDULES}
    assert EXPECTED_SCHEDULE_NAMES <= names


@pytest.mark.asyncio
async def test_on_work_item_status_changed_starts_dependents(tmp_path, monkeypatch):
    from app.core.runtime.kernel import Kernel
    from app.store.database import Database

    k = Kernel(db=Database(db_path=str(tmp_path / "sched_task.db")))
    monkeypatch.setattr("app.core.runtime.cron_registry.kernel", k)
    monkeypatch.setattr("app.core.runtime.work_item_engine.kernel", k)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)

    k.emit_event("WorkItemCreated", "work_item", "t1", payload={"title": "Dep"})
    k.emit_event(
        "WorkItemCreated",
        "work_item",
        "t2",
        payload={"title": "Blocked", "dependencies_json": '["t1"]'},
    )
    k.emit_event("WorkItemStatusChanged", "work_item", "t1", payload={"status": "completed"}, actor="user")

    from app.core.runtime.cron_registry import _on_work_item_status_changed
    from app.core.runtime.kernel.event import Event

    evt = Event(
        type="WorkItemStatusChanged",
        aggregate_type="work_item",
        aggregate_id="t1",
        payload={"status": "completed"},
    )
    _on_work_item_status_changed(evt)

    task2 = k.query_state("work_items", id="t2")[0]
    assert task2["status"] == "running"


def test_shutdown_scheduler_unsubscribes_triggers(tmp_path, monkeypatch):
    """shutdown_scheduler clears WorkItem* subscriptions from init_scheduler."""
    from app.core.runtime import cron_registry as cr
    from app.core.runtime.kernel import Kernel
    from app.store.database import Database

    k = Kernel(db=Database(db_path=str(tmp_path / "cron_unsub.db")))
    monkeypatch.setattr("app.core.runtime.cron_registry.kernel", k)
    monkeypatch.setattr(
        "app.core.runtime.cron_registry.read_ports.query_timer",
        lambda name: {"id": name},
    )
    cr.shutdown_scheduler()
    before = len(k._subscribers)
    cr.init_scheduler()
    assert len(k._subscribers) == before + 1
    cr.shutdown_scheduler()
    assert len(k._subscribers) == before

def test_next_cron_fire_returns_aware_future():
    from datetime import UTC, datetime

    from app.core.runtime.runtime_loop import RuntimeLoop

    now = datetime.now(UTC)
    result = RuntimeLoop._next_cron_fire("minute=*/15", from_ts=now)
    assert result is not None
    parsed = datetime.fromisoformat(result)
    assert parsed.tzinfo is not None
    assert parsed > now


def test_init_timers_reseeds_fired_named_timer(isolated_kernel, monkeypatch):
    """Fired named cron rows must be re-created as active on startup."""
    k, _db = isolated_kernel
    monkeypatch.setattr("app.core.runtime.cron_registry.kernel", k)

    k.emit_event(
        "TimerCreated",
        "timer",
        "morning_brief",
        payload={
            "handler_name": "morning_brief",
            "schedule_type": "cron",
            "cron_expr": "hour=8,minute=0",
            "fire_at": "2020-01-01T00:00:00Z",
        },
        actor="test",
    )
    k.emit_event(
        "TimerFired",
        "timer",
        "morning_brief",
        payload={"fired_at": "2020-01-01T00:00:01Z", "handler_name": "morning_brief"},
        actor="test",
    )
    assert k.query_state("timer_events", id="morning_brief")[0]["status"] == "fired"

    from app.core.runtime.cron_registry import _init_timers

    _init_timers()
    row = k.query_state("timer_events", id="morning_brief")[0]
    assert row["status"] == "active"
    assert row["fire_at"] > "2020-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test_cron_fire_reuses_aggregate_id(isolated_kernel, monkeypatch):
    """TimerFired + next TimerCreated share the named id so restart can heal."""
    from datetime import UTC, datetime, timedelta

    from app.core.runtime.runtime_loop import RuntimeLoop
    import app.core.runtime.runtime_loop as rl_mod

    k, _db = isolated_kernel
    past = (datetime.now(UTC) - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    k.emit_event(
        "TimerCreated",
        "timer",
        "morning_brief",
        payload={
            "handler_name": "morning_brief",
            "schedule_type": "cron",
            "cron_expr": "hour=8,minute=0",
            "fire_at": past,
        },
        actor="test",
    )
    monkeypatch.setattr(rl_mod, "kernel", k)

    await RuntimeLoop()._check_timers()

    row = k.query_state("timer_events", id="morning_brief")[0]
    assert row["status"] == "active"
    assert row["fire_at"] > past
    with _db.get_db() as conn:
        fired = conn.execute(
            "SELECT 1 FROM event_log WHERE type='TimerFired' "
            "AND aggregate_id='morning_brief' LIMIT 1"
        ).fetchone()
        created = conn.execute(
            "SELECT COUNT(*) FROM event_log WHERE type='TimerCreated' "
            "AND aggregate_id='morning_brief'"
        ).fetchone()
    assert fired is not None
    assert created[0] >= 2


@pytest.mark.asyncio
async def test_cron_reschedule_failure_healed_by_init_timers(isolated_kernel, monkeypatch):
    """If TimerCreated after fire fails, _init_timers restores the named row."""
    from datetime import UTC, datetime, timedelta

    from app.core.runtime.runtime_loop import RuntimeLoop
    import app.core.runtime.runtime_loop as rl_mod

    k, _db = isolated_kernel
    past = (datetime.now(UTC) - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    k.emit_event(
        "TimerCreated",
        "timer",
        "morning_brief",
        payload={
            "handler_name": "morning_brief",
            "schedule_type": "cron",
            "cron_expr": "hour=8,minute=0",
            "fire_at": past,
        },
        actor="test",
    )

    original_emit = k.emit_event

    def _emit(event_type, *args, **kwargs):
        if event_type == "TimerCreated":
            raise RuntimeError("reschedule boom")
        return original_emit(event_type, *args, **kwargs)

    monkeypatch.setattr(k, "emit_event", _emit)
    monkeypatch.setattr(rl_mod, "kernel", k)
    await RuntimeLoop()._check_timers()
    assert k.query_state("timer_events", id="morning_brief")[0]["status"] == "fired"

    monkeypatch.setattr(k, "emit_event", original_emit)
    monkeypatch.setattr("app.core.runtime.cron_registry.kernel", k)
    from app.core.runtime.cron_registry import _init_timers

    _init_timers()
    assert k.query_state("timer_events", id="morning_brief")[0]["status"] == "active"

