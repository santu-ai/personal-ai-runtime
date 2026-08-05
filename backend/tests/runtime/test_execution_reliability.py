"""Execution reliability locks (E-1..E-6): idempotency, DLQ, lease, progress."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture(autouse=True)
def _reset_scheduler():
    from app.core.runtime.agent_scheduler import reset_scheduler

    reset_scheduler()
    yield
    reset_scheduler()


@pytest.fixture
def kernel(tmp_path):
    from app.core.runtime.kernel import Kernel
    from app.store.database import Database

    return Kernel(db=Database(db_path=str(tmp_path / "exec_rel.db")))


@pytest.mark.asyncio
async def test_plan_step_idempotency_skips_invoke(tmp_path):
    """E-1: already-recorded step success skips invoke_capability."""
    from app.core.runtime.handlers.plan_runner import run_plan_steps
    from app.core.runtime.plan_resume import (
        clear_plan_resumes,
        configure_plan_resume_db,
        record_step_success,
    )
    from app.store.database import Database

    db = Database(db_path=str(tmp_path / "idem.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    try:
        record_step_success("corr-1", 0, "cached-ok", action_id="a1")
        kernel = MagicMock()
        kernel.invoke_capability = AsyncMock(
            return_value={"status": "success", "result": "should-not-run"},
        )
        outcome = await run_plan_steps(
            steps=[{"tool": "echo", "params": {}}],
            kernel=kernel,
            actor="test",
            execution_id="exec-idem",
            correlation_id="corr-1",
            action_id="a1",
        )
        assert outcome.stopped_reason == "completed"
        assert outcome.results[0].result == "cached-ok"
        kernel.invoke_capability.assert_not_awaited()
    finally:
        clear_plan_resumes()
        configure_plan_resume_db(None)


@pytest.mark.asyncio
async def test_plan_progress_persists_between_steps(tmp_path):
    """E-5: each success writes progress:{action_id} resume_from."""
    from app.core.runtime.handlers.plan_runner import run_plan_steps
    from app.core.runtime.plan_resume import (
        clear_plan_resumes,
        configure_plan_resume_db,
        load_plan_progress,
    )
    from app.store.database import Database

    db = Database(db_path=str(tmp_path / "prog.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    try:
        kernel = MagicMock()
        kernel.invoke_capability = AsyncMock(
            side_effect=[
                {"status": "success", "result": "s0"},
                {"status": "success", "result": "s1"},
            ],
        )
        await run_plan_steps(
            steps=[
                {"tool": "echo", "params": {}},
                {"tool": "echo", "params": {}},
            ],
            kernel=kernel,
            actor="test",
            execution_id="exec-prog",
            correlation_id="corr-p",
            action_id="act-p",
        )
        prog = load_plan_progress("act-p")
        assert prog is not None
        assert prog.resume_from == 2
    finally:
        clear_plan_resumes()
        configure_plan_resume_db(None)


def test_dead_letter_mark_and_replay(kernel):
    """E-3: terminal ExecutionFailed sets dead_letter; replay clears it."""
    from app.core.runtime.execution_events import (
        emit_execution_failed,
        emit_execution_requested,
        emit_execution_started,
    )
    from app.core.runtime.scheduled_execution import ExecutionPolicy, ScheduledExecution

    item = ScheduledExecution(
        event_type="ChatRequested",
        handler_name="on_chat",
        instance_id="test",
        policy=ExecutionPolicy(max_retries=0),
        correlation_id="c-dlq",
    )
    emit_execution_requested(kernel, item, "test")
    item.transition_to("running")
    emit_execution_started(kernel, item)
    item.error = "boom"
    item.transition_to("failed")
    emit_execution_failed(kernel, item, terminal=True, dead_letter=True)

    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "failed"
    assert row.dead_letter is True

    replayed = kernel.replay_dead_letters(limit=10)
    assert item.id in replayed
    after = kernel.read_scheduled_execution(item.id)
    assert after is not None
    assert after.status == "pending"
    assert after.dead_letter is False


def test_reclaim_stale_leases_marks_timeout(kernel):
    """E-4: running past lease TTL is failed (and DLQ when retries exhausted)."""
    from app.core.runtime.agent_scheduler import get_scheduler
    from app.core.runtime.execution_events import (
        emit_execution_requested,
        emit_execution_started,
    )
    from app.core.runtime.scheduled_execution import ExecutionPolicy, ScheduledExecution

    # Create scheduler *before* seeding a running row so _recover does not
    # convert it to pending before reclaim runs.
    sch = get_scheduler(kernel)

    old = (datetime.now(UTC) - timedelta(seconds=3600)).isoformat()
    item = ScheduledExecution(
        event_type="TimerFired",
        handler_name="on_timer",
        instance_id="test",
        policy=ExecutionPolicy(max_retries=0),
        started_at=old,
    )
    emit_execution_requested(kernel, item, "test")
    item.transition_to("running")
    item.started_at = old
    emit_execution_started(kernel, item)
    with kernel._db.get_db() as conn:
        conn.execute(
            "UPDATE handler_executions SET started_at = ? WHERE id = ?",
            (old, item.id),
        )

    n = sch.reclaim_stale_leases(ttl_seconds=60)
    assert n == 1
    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "failed"
    assert row.error == "timeout"
    assert row.dead_letter is True


def test_expire_stale_running_leases_kernel(kernel):
    """Kernel lease expiry path for orphaned running rows."""
    from app.core.runtime.execution_events import (
        emit_execution_requested,
        emit_execution_started,
    )
    from app.core.runtime.scheduled_execution import ExecutionPolicy, ScheduledExecution

    old = (datetime.now(UTC) - timedelta(seconds=9999)).isoformat()
    item = ScheduledExecution(
        event_type="TimerFired",
        handler_name="on_timer",
        instance_id="test",
        policy=ExecutionPolicy(max_retries=0),
    )
    emit_execution_requested(kernel, item, "test")
    item.transition_to("running")
    emit_execution_started(kernel, item)
    with kernel._db.get_db() as conn:
        conn.execute(
            "UPDATE handler_executions SET started_at = ? WHERE id = ?",
            (old, item.id),
        )

    n = kernel.expire_stale_running_leases(ttl_seconds=60)
    assert n == 1
    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "failed"
    assert row.error == "timeout"
    assert row.dead_letter is True


@pytest.mark.asyncio
async def test_background_timeout_marks_work_item_failed(kernel, monkeypatch):
    """E-2: submit_command error dict must not leave work item stuck running."""
    from app.config import settings
    from app.core.runtime.kernel.constants import (
        AGGREGATE_WORK_ITEM,
        EVENT_EXECUTE_REQUESTED,
        EVENT_WORK_ITEM_CREATED,
        EVENT_WORK_ITEM_STATUS_CHANGED,
    )

    wid = "bg_stuck_1"
    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED,
        AGGREGATE_WORK_ITEM,
        wid,
        payload={
            "title": "bg",
            "work_type": "background",
            "status": "pending",
            "plan": '{"steps": []}',
        },
        actor="test",
    )

    async def _fake_submit(*_a, **_k):
        return {"error": "timeout"}

    monkeypatch.setattr(kernel, "submit_command", _fake_submit)

    kernel.emit_event(
        EVENT_WORK_ITEM_STATUS_CHANGED,
        AGGREGATE_WORK_ITEM,
        wid,
        payload={"status": "running"},
        actor="background",
    )

    result = await kernel.submit_command(
        EVENT_EXECUTE_REQUESTED,
        "action",
        f"exec_{wid}",
        payload={"action_id": wid},
        actor="background",
        timeout=settings.submit_command_timeout_background_task,
    )
    assert isinstance(result, dict) and result.get("error")
    kernel.emit_event(
        EVENT_WORK_ITEM_STATUS_CHANGED,
        AGGREGATE_WORK_ITEM,
        wid,
        payload={"status": "failed", "error": str(result.get("error"))},
        actor="background",
    )
    row = kernel.query_state("work_items", id=wid, limit=1)[0]
    assert row["status"] == "failed"


def test_approve_take_before_resume(tmp_path):
    """E-6: take_plan_resume removes entry so concurrent approve cannot double-resume."""
    from app.core.runtime.plan_resume import (
        PlanResume,
        clear_plan_resumes,
        configure_plan_resume_db,
        peek_plan_resume,
        register_plan_resume,
        take_plan_resume,
    )
    from app.store.database import Database

    db = Database(db_path=str(tmp_path / "take.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    try:
        register_plan_resume(
            "apr_x",
            PlanResume(kind="execute", resume_from=1, action_id="a1"),
        )
        first = take_plan_resume("apr_x")
        second = take_plan_resume("apr_x")
        assert first is not None
        assert second is None
        assert peek_plan_resume("apr_x") is None
    finally:
        clear_plan_resumes()
        configure_plan_resume_db(None)
