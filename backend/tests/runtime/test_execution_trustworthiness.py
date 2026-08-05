"""Batch 6 — execution trustworthiness regression locks (E-1 … E-9)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.runtime.plan_resume import (
    clear_plan_resumes,
    configure_plan_resume_db,
    load_plan_progress,
    lookup_step_success,
    record_step_success,
    save_plan_progress,
)


@pytest.fixture(autouse=True)
def _reset_scheduler():
    from app.core.runtime.agent_scheduler import reset_agent_bootstrap, reset_scheduler

    reset_scheduler()
    reset_agent_bootstrap()
    yield
    reset_scheduler()
    reset_agent_bootstrap()


@pytest.fixture
def kernel(tmp_path):
    from app.core.runtime.kernel import Kernel
    from app.store.database import Database

    return Kernel(db=Database(db_path=str(tmp_path / "trust.db")))


# ── E-1: step idempotency ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_plan_step_idempotency_skips_side_effects(tmp_path):
    """Retry must not re-invoke a capability already succeeded for this corr."""
    from app.core.runtime.handlers.plan_runner import run_plan_steps
    from app.store.database import Database

    db = Database(db_path=str(tmp_path / "idem.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    try:
        record_step_success("corr_idem", 0, "already-done", action_id="act_1")
        kernel = MagicMock()
        kernel.invoke_capability = AsyncMock(
            return_value={"status": "success", "result": "should-not-run"}
        )
        outcome = await run_plan_steps(
            steps=[
                {"tool": "t1", "params": {}},
                {"tool": "t2", "params": {}},
            ],
            kernel=kernel,
            actor="executor",
            execution_id="ex1",
            correlation_id="corr_idem",
            action_id="act_1",
        )
        assert outcome.stopped_reason == "completed"
        assert outcome.results[0].result == "already-done"
        # Only step 1 invoked; step 0 was cached.
        assert kernel.invoke_capability.await_count == 1
        assert kernel.invoke_capability.await_args.kwargs["name"] == "t2"
        assert lookup_step_success("corr_idem", 1) == "should-not-run"
    finally:
        clear_plan_resumes()
        configure_plan_resume_db(None)


# ── E-5: step progress persistence ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_plan_progress_persisted_and_used_on_resume(tmp_path, monkeypatch):
    from app.core.runtime.handlers import execute_handlers as mod
    from app.store.database import Database

    db = Database(db_path=str(tmp_path / "prog.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    save_plan_progress(
        "act_prog",
        resume_from=1,
        previous_output={"step_0_output": "cached"},
    )
    try:
        emitted: list = []

        class Ctx:
            execution_id = "ex"
            correlation_id = "c_prog"

            def emit(self, *args, **kwargs):
                emitted.append((args, kwargs))

        monkeypatch.setattr(
            "app.core.runtime.read_ports.query_work_item",
            lambda _id: {
                "id": "act_prog",
                "status": "running",
                "executable_plan": (
                    '{"steps":[{"tool":"t0","params":{}},'
                    '{"tool":"t1","params":{}}]}'
                ),
            },
        )
        k = MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "success", "result": "step1-ok"}
            ),
        )
        monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)

        event = MagicMock()
        event.id = "e1"
        # No resume_from in payload — must use durable progress.
        event.payload = {"action_id": "act_prog"}

        await mod.on_execute_requested(Ctx(), event)

        assert k.invoke_capability.await_count == 1
        assert k.invoke_capability.await_args.kwargs["name"] == "t1"
        progress = load_plan_progress("act_prog")
        assert progress is not None
        assert progress.resume_from == 2
    finally:
        clear_plan_resumes()
        configure_plan_resume_db(None)


# ── E-3: dead letter + replay ──────────────────────────────────────────────


def test_execution_failed_sets_dead_letter(kernel):
    from app.core.runtime.execution_events import (
        emit_execution_failed,
        emit_execution_requested,
    )
    from app.core.runtime.scheduled_execution import (
        ExecutionPolicy,
        ScheduledExecution,
    )

    item = ScheduledExecution(
        event_type="ExecuteRequested",
        handler_name="on_execute_requested",
        instance_id="runtime:primary",
        policy=ExecutionPolicy(max_retries=0),
        error="boom",
    )
    emit_execution_requested(kernel, item, "scheduler")
    item.transition_to("running")
    item.transition_to("failed")
    emit_execution_failed(kernel, item, terminal=True, dead_letter=True)

    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "failed"
    assert row.dead_letter is True
    dead = kernel.list_dead_letter_executions()
    assert any(d.id == item.id for d in dead)


def test_replay_dead_letters_clears_flag(kernel):
    from app.core.runtime.execution_events import (
        emit_execution_failed,
        emit_execution_requested,
    )
    from app.core.runtime.scheduled_execution import (
        ExecutionPolicy,
        ScheduledExecution,
    )

    item = ScheduledExecution(
        event_type="TimerFired",
        handler_name="h",
        instance_id="runtime:primary",
        policy=ExecutionPolicy(max_retries=0),
        error="boom",
        event_id="evt_dl",
    )
    emit_execution_requested(kernel, item, "scheduler")
    item.transition_to("running")
    item.transition_to("failed")
    emit_execution_failed(kernel, item, terminal=True, dead_letter=True)

    replayed = kernel.replay_dead_letters(limit=10)
    assert item.id in replayed
    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "pending"
    assert row.dead_letter is False
    assert kernel.list_dead_letter_executions() == []


# ── E-4: lease TTL ─────────────────────────────────────────────────────────


def test_expire_stale_running_leases(kernel, monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.running_lease_ttl_seconds", 60,
    )
    from app.core.runtime.execution_events import (
        emit_execution_requested,
        emit_execution_started,
    )
    from app.core.runtime.scheduled_execution import (
        ExecutionPolicy,
        ScheduledExecution,
    )

    old = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
    item = ScheduledExecution(
        event_type="ExecuteRequested",
        handler_name="h",
        instance_id="runtime:primary",
        policy=ExecutionPolicy(max_retries=0),
        started_at=old,
    )
    emit_execution_requested(kernel, item, "scheduler")
    item.transition_to("running")
    item.started_at = old
    emit_execution_started(kernel, item)

    n = kernel.expire_stale_running_leases(ttl_seconds=60)
    assert n == 1
    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "failed"
    assert row.error == "timeout"
    assert row.dead_letter is True  # max_retries=0 → terminal


def test_scheduler_reclaim_stale_leases_requeues(kernel, monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.running_lease_ttl_seconds", 30,
    )
    from app.core.runtime.agent_scheduler import Scheduler
    from app.core.runtime.execution_events import (
        emit_execution_requested,
        emit_execution_started,
    )
    from app.core.runtime.scheduled_execution import (
        ExecutionPolicy,
        ScheduledExecution,
    )

    # Construct scheduler first so _recover does not swallow the stale row.
    sch = Scheduler(kernel)

    old = (datetime.now(UTC) - timedelta(seconds=120)).isoformat()
    item = ScheduledExecution(
        event_type="ExecuteRequested",
        handler_name="h",
        instance_id="runtime:primary",
        policy=ExecutionPolicy(max_retries=2, retry_delay_seconds=0),
        started_at=old,
    )
    emit_execution_requested(kernel, item, "scheduler")
    item.transition_to("running")
    item.started_at = old
    emit_execution_started(kernel, item)
    # Projector may stamp started_at from payload; force stale timestamp.
    with kernel._db.get_db() as conn:
        conn.execute(
            "UPDATE handler_executions SET started_at = ? WHERE id = ?",
            (old, item.id),
        )

    n = sch.reclaim_stale_leases(30)
    assert n == 1
    row = kernel.read_scheduled_execution(item.id)
    assert row is not None
    assert row.status == "pending"
    assert any(p.id == item.id for p in sch._pending)


# ── E-2: background dispatch failure marks failed ──────────────────────────


@pytest.mark.asyncio
async def test_dispatch_bg_marks_failed_on_timeout(kernel, monkeypatch):
    from app.core.runtime.kernel.constants import (
        AGGREGATE_WORK_ITEM,
        EVENT_WORK_ITEM_CREATED,
    )
    from app.core.runtime.runtime_loop import RuntimeLoop

    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED,
        AGGREGATE_WORK_ITEM,
        "bg_to",
        payload={
            "title": "bg",
            "work_type": "background",
            "status": "pending",
            "executable_plan": '{"steps":[{"tool":"echo","params":{}}]}',
        },
        actor="test",
    )

    async def fake_submit(*_a, **_k):
        return {"status": "timeout", "error": "timeout"}

    kernel.submit_command = fake_submit  # type: ignore[method-assign]

    import app.core.runtime.kernel_instance as ki
    import app.core.runtime.runtime_loop as rl_mod

    monkeypatch.setattr(rl_mod, "kernel", kernel)
    monkeypatch.setattr(ki, "kernel", kernel)

    loop = RuntimeLoop()

    async def _noop_ensure(_k):
        return None

    class _Sch:
        async def start(self):
            return None

    monkeypatch.setattr(
        "app.core.runtime.agent_scheduler.ensure_scheduler",
        _noop_ensure,
    )
    monkeypatch.setattr(
        "app.core.runtime.agent_scheduler.get_scheduler",
        lambda _k: _Sch(),
    )
    await loop._process_background_tasks()
    if loop._bg_tasks:
        import asyncio

        await asyncio.gather(*list(loop._bg_tasks), return_exceptions=True)

    rows = kernel.query_state("work_items", id="bg_to", limit=1)
    assert rows
    assert rows[0]["status"] == "failed"


# ── E-6: approve take-first ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_approve_take_first_is_idempotent(tmp_path, monkeypatch):
    from app.core.runtime.handlers import approve_handlers as mod
    from app.core.runtime.plan_resume import PlanResume, peek_plan_resume, register_plan_resume
    from app.store.database import Database

    db = Database(db_path=str(tmp_path / "apr.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    register_plan_resume(
        "apr_once",
        PlanResume(kind="execute", resume_from=1, action_id="act_x"),
    )
    try:
        emitted: list = []

        class Ctx:
            execution_id = "ex"
            correlation_id = "c"

            def emit(self, *args, **kwargs):
                emitted.append((args, kwargs))

        monkeypatch.setattr(
            "app.core.runtime.kernel_instance.kernel",
            MagicMock(
                invoke_capability=AsyncMock(
                    return_value={"status": "success", "result": "ok"}
                ),
            ),
        )
        event = MagicMock()
        event.id = "e"
        event.payload = {
            "approval_id": "apr_once",
            "decision": "approve",
            "tool_name": "write_file",
            "tool_args": {},
            "conv_id": "",
            "tool_call_id": "",
        }
        await mod.on_approve_requested(Ctx(), event)
        resumes = [e for e in emitted if e[0] and e[0][0] == "ExecuteRequested"]
        assert len(resumes) == 1
        assert peek_plan_resume("apr_once") is None

        # Second approve: resume already taken — no second ExecuteRequested.
        emitted.clear()
        await mod.on_approve_requested(Ctx(), event)
        resumes2 = [e for e in emitted if e[0] and e[0][0] == "ExecuteRequested"]
        assert resumes2 == []
    finally:
        clear_plan_resumes()
        configure_plan_resume_db(None)


# ── E-7: scheduler does not gather-block the whole batch ───────────────────


@pytest.mark.asyncio
async def test_scheduler_loop_starts_items_without_batch_gather(kernel, monkeypatch):
    """E-7: slots fill independently — no await gather on the whole batch."""
    import asyncio
    import inspect

    from app.core.runtime import agent_scheduler as mod

    src = inspect.getsource(mod.Scheduler._scheduler_loop)
    assert "asyncio.gather" not in src
    assert "len(self._active)" in src

    started = asyncio.Event()
    second_started = asyncio.Event()
    release = asyncio.Event()
    call_count = {"n": 0}

    async def fake_process(self, item):
        call_count["n"] += 1
        if call_count["n"] == 1:
            started.set()
            await release.wait()
        else:
            second_started.set()

    monkeypatch.setattr(
        "app.config.settings.scheduler_max_concurrent", 2,
    )
    monkeypatch.setattr(mod.Scheduler, "_process_work_item", fake_process)

    sch = mod.Scheduler(kernel)
    sch._tick_interval = 0.01
    from app.core.runtime.scheduled_execution import ScheduledExecution

    for i in range(2):
        sch._pending.append(
            ScheduledExecution(
                id=f"wi_probe_{i}",
                event_type="Probe",
                handler_name="h",
                instance_id="runtime:primary",
            )
        )

    sch._running = True
    task = asyncio.create_task(sch._scheduler_loop())
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        await asyncio.wait_for(second_started.wait(), timeout=2)
        assert call_count["n"] >= 2
    finally:
        release.set()
        sch._running = False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


# ── E-9: TimerFired emit failure leaves timer active ───────────────────────


@pytest.mark.asyncio
async def test_timer_emit_failure_leaves_active(isolated_kernel, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from app.core.runtime.runtime_loop import RuntimeLoop

    k, db = isolated_kernel
    past = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    k.emit_event(
        "TimerCreated", "timer", "timer_fail_emit",
        payload={
            "handler_name": "test_handler",
            "schedule_type": "once",
            "cron_expr": "",
            "fire_at": past,
        },
        actor="verify",
    )

    import app.core.runtime.runtime_loop as rl_mod

    original = rl_mod.kernel
    rl_mod.kernel = k

    real_emit = k.emit_event

    def boom(type, *args, **kwargs):
        if type == "TimerFired":
            raise RuntimeError("emit failed")
        return real_emit(type, *args, **kwargs)

    k.emit_event = boom  # type: ignore[method-assign]
    try:
        loop = RuntimeLoop()
        await loop._check_timers()
    finally:
        k.emit_event = real_emit  # type: ignore[method-assign]
        rl_mod.kernel = original

    rows = k.query_state("timer_events", id="timer_fail_emit", limit=1)
    assert rows
    assert rows[0]["status"] == "active"


def test_running_lease_ttl_config_default():
    from app.config import Settings

    assert Settings().running_lease_ttl_seconds == 600
