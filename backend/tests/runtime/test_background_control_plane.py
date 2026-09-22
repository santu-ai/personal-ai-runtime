"""Background work-item recovery + cooperative cancellation (INV-W5)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.runtime.execution import (
    clear_all_cancels,
    is_execution_cancelled,
)
from app.core.runtime.execution_events import (
    emit_execution_completed,
    emit_execution_requested,
)
from app.core.runtime.handlers.plan_runner import run_plan_steps
from app.core.runtime.kernel.constants import (
    AGGREGATE_WORK_ITEM,
    EVENT_WORK_ITEM_CREATED,
    EVENT_WORK_ITEM_STATUS_CHANGED,
)
from app.core.runtime.kernel.event import Event
from app.core.runtime.scheduled_execution import ScheduledExecution


@pytest.fixture(autouse=True)
def _reset_cancels_and_scheduler():
    from app.core.runtime.agent_scheduler import reset_scheduler

    clear_all_cancels()
    reset_scheduler()
    yield
    clear_all_cancels()
    reset_scheduler()


@pytest.fixture
def kernel(tmp_path):
    from app.core.runtime.kernel import Kernel
    from app.store.database import Database

    return Kernel(db=Database(db_path=str(tmp_path / "bg_ctl.db")))


def _create_running(kernel, work_id: str = "t1") -> None:
    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED,
        AGGREGATE_WORK_ITEM,
        work_id,
        payload={
            "title": "x",
            "description": "",
            "work_type": "background",
            "parent_work_id": None,
            "status": "pending",
            "priority": 0,
            "executable_plan": "{}",
            "progress": 0.0,
            "created_at": "2026-01-01T00:00:00Z",
        },
        actor="user",
    )
    kernel.emit_event(
        EVENT_WORK_ITEM_STATUS_CHANGED,
        AGGREGATE_WORK_ITEM,
        work_id,
        payload={"status": "running"},
        actor="background",
    )


def test_recover_interrupted_background_tasks_requeues_running(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    _create_running(kernel, "stuck")
    monkeypatch.setattr("app.core.runtime.runtime_loop.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr(
        "app.core.runtime.read_ports.work.kernel",
        lambda: kernel,
    )

    loop = RuntimeLoop()
    n = loop._recover_interrupted_background_tasks()
    assert n == 1
    rows = kernel.query_state("work_items", id="stuck", limit=1)
    assert rows[0]["status"] == "pending"


def test_recover_skips_waiting_approval(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    _create_running(kernel, "wa")
    kernel.emit_event(
        EVENT_WORK_ITEM_STATUS_CHANGED,
        AGGREGATE_WORK_ITEM,
        "wa",
        payload={"status": "waiting_approval"},
        actor="background",
    )
    monkeypatch.setattr("app.core.runtime.runtime_loop.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr(
        "app.core.runtime.read_ports.work.kernel",
        lambda: kernel,
    )

    loop = RuntimeLoop()
    assert loop._recover_interrupted_background_tasks() == 0
    rows = kernel.query_state("work_items", id="wa", limit=1)
    assert rows[0]["status"] == "waiting_approval"


def test_recover_running_task_missing_execute_dispatch(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED,
        AGGREGATE_WORK_ITEM,
        "task-gap",
        payload={
            "title": "task",
            "work_type": "task",
            "status": "running",
            "executable_plan": '{"steps":[{"tool":"read_file"}]}',
        },
        actor="user",
    )
    monkeypatch.setattr("app.core.runtime.runtime_loop.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.read_ports.work.kernel", lambda: kernel)

    loop = RuntimeLoop()
    assert loop._recover_interrupted_background_tasks() == 1
    events = kernel.read_events(
        type="ExecuteRequested", aggregate_id="exec_task-gap",
    )
    assert len(events) == 1


def test_recover_running_task_with_scheduled_execution_is_idempotent(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED, AGGREGATE_WORK_ITEM, "scheduled",
        payload={
            "title": "task",
            "work_type": "task",
            "status": "running",
            "executable_plan": '{"steps":[{"tool":"read_file"}]}',
        },
        actor="user",
    )
    trigger = kernel.emit_event(
        "ExecuteRequested", "action", "exec_scheduled",
        payload={"action_id": "scheduled"}, actor="user",
    )
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    emit_execution_requested(kernel, item, "user")
    monkeypatch.setattr("app.core.runtime.runtime_loop.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.read_ports.work.kernel", lambda: kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 0
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_scheduled")) == 1


def test_recover_does_not_redispatch_finished_task(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED, AGGREGATE_WORK_ITEM, "finished",
        payload={
            "title": "task",
            "work_type": "task",
            "status": "running",
            "executable_plan": '{"steps":[{"tool":"read_file"}]}',
        },
        actor="user",
    )
    trigger = kernel.emit_event(
        "ExecuteRequested", "action", "exec_finished",
        payload={"action_id": "finished"}, actor="user",
    )
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    emit_execution_requested(kernel, item, "user")
    emit_execution_completed(kernel, item)
    monkeypatch.setattr("app.core.runtime.runtime_loop.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.read_ports.work.kernel", lambda: kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 0
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_finished")) == 1
    assert kernel.query_state("work_items", id="finished", limit=1)[0]["status"] == "running"


def _patch_kernel(monkeypatch, kernel) -> None:
    monkeypatch.setattr("app.core.runtime.runtime_loop.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    monkeypatch.setattr("app.core.runtime.read_ports.work.kernel", lambda: kernel)


def _running_with_execute(kernel, work_id: str, *, work_type: str = "task"):
    kernel.emit_event(
        EVENT_WORK_ITEM_CREATED, AGGREGATE_WORK_ITEM, work_id,
        payload={
            "title": work_id,
            "work_type": work_type,
            "status": "running",
            "executable_plan": '{"steps":[{"tool":"read_file"}]}',
        },
        actor="user",
    )
    trigger = kernel.emit_event(
        "ExecuteRequested", "action", f"exec_{work_id}",
        payload={"action_id": work_id}, actor="user",
    )
    return trigger


def test_recover_closes_dead_lettered_task(kernel, monkeypatch):
    from app.core.runtime.execution_events import emit_execution_failed
    from app.core.runtime.runtime_loop import RuntimeLoop

    trigger = _running_with_execute(kernel, "dead")
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    item.error = "interrupted"
    emit_execution_requested(kernel, item, "user")
    emit_execution_failed(kernel, item, terminal=True, dead_letter=True)
    _patch_kernel(monkeypatch, kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 1
    assert kernel.query_state("work_items", id="dead", limit=1)[0]["status"] == "failed"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_dead")) == 1


def test_recover_does_not_requeue_background_after_dead_letter(kernel, monkeypatch):
    from app.core.runtime.execution_events import emit_execution_failed
    from app.core.runtime.runtime_loop import RuntimeLoop

    trigger = _running_with_execute(kernel, "bg-dead", work_type="background")
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    item.error = "interrupted"
    emit_execution_requested(kernel, item, "user")
    emit_execution_failed(kernel, item, terminal=True, dead_letter=True)
    _patch_kernel(monkeypatch, kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 1
    row = kernel.query_state("work_items", id="bg-dead", limit=1)[0]
    assert row["status"] == "failed"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_bg-dead")) == 1


def test_recover_leaves_background_with_live_handler(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    trigger = _running_with_execute(kernel, "bg-live", work_type="background")
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    emit_execution_requested(kernel, item, "user")
    _patch_kernel(monkeypatch, kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 0
    assert kernel.query_state("work_items", id="bg-live", limit=1)[0]["status"] == "running"


def test_recover_syncs_completed_handler_from_execute_completed(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    trigger = _running_with_execute(kernel, "synced")
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    emit_execution_requested(kernel, item, "user")
    emit_execution_completed(kernel, item)
    kernel.emit_event(
        "ExecuteCompleted", "action", "exec_synced",
        payload={"action_id": "synced", "status": "success"},
        actor="executor",
        caused_by=trigger.id,
    )
    _patch_kernel(monkeypatch, kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 1
    assert kernel.query_state("work_items", id="synced", limit=1)[0]["status"] == "completed"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_synced")) == 1


def test_recover_does_not_requeue_background_after_completed_handler(kernel, monkeypatch):
    from app.core.runtime.runtime_loop import RuntimeLoop

    trigger = _running_with_execute(kernel, "bg-done", work_type="background")
    item = ScheduledExecution(event_id=trigger.id, event_seq=trigger.seq or 0)
    emit_execution_requested(kernel, item, "user")
    emit_execution_completed(kernel, item)
    _patch_kernel(monkeypatch, kernel)

    assert RuntimeLoop()._recover_interrupted_background_tasks() == 0
    assert kernel.query_state("work_items", id="bg-done", limit=1)[0]["status"] == "running"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_bg-done")) == 1


@pytest.mark.asyncio
async def test_plan_runner_stops_on_cancel_check():
    mock_kernel = MagicMock()
    mock_kernel.invoke_capability = AsyncMock(
        return_value={"status": "success", "result": "ok"}
    )
    cancelled = {"n": 0}

    def cancel_check() -> bool:
        cancelled["n"] += 1
        return cancelled["n"] >= 1

    outcome = await run_plan_steps(
        steps=[
            {"tool": "t1", "params": {}},
            {"tool": "t2", "params": {}},
        ],
        kernel=mock_kernel,
        actor="background",
        execution_id="ex1",
        correlation_id=None,
        cancel_check=cancel_check,
    )
    assert outcome.stopped_reason == "cancelled"
    mock_kernel.invoke_capability.assert_not_awaited()


def test_scheduler_cancel_executions_for(kernel):
    from app.core.runtime.agent_scheduler import Scheduler

    sch = Scheduler(kernel)
    sch._pending.clear()

    evt = Event(
        type="ExecuteRequested",
        aggregate_type="action",
        aggregate_id="exec_x",
        payload={"action_id": "x"},
        actor="background",
    ).with_seq(1)
    item = ScheduledExecution(
        event_seq=1,
        event_id=evt.id,
        event_type="ExecuteRequested",
        handler_name="on_execute_requested",
        instance_id="runtime:primary",
        _event=evt,
    )
    emit_execution_requested(kernel, item, "background")
    sch._pending.append(item)

    assert sch.cancel_executions_for("x") == 1
    assert all(i.id != item.id for i in sch._pending)
    rows = kernel.read_scheduled_executions(status="failed")
    assert any(r.id == item.id and r.error == "cancelled" for r in rows)


@pytest.mark.asyncio
async def test_cancel_background_task_clears_plan_resume(kernel, monkeypatch):
    """Cancel via Ports ABI 清除 plan_resume 并设置 execution 取消 flag。

    原测试走已下线的 /api/tasks/background HTTP handler；改为直接验证
    read_ports.cancel_background_work_item（HTTP 端点只是它的薄包装）。
    """
    from app.core.runtime import read_ports
    from app.core.runtime.plan_resume import (
        PlanResume,
        configure_plan_resume_db,
        peek_plan_resume,
        register_plan_resume,
    )

    _create_running(kernel, "c1")
    configure_plan_resume_db(kernel._db)
    register_plan_resume(
        "apr_c1",
        PlanResume(kind="execute", resume_from=1, action_id="c1"),
        db=kernel._db,
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.work.kernel",
        lambda: kernel,
    )
    monkeypatch.setattr(
        "app.core.runtime.runtime_container.runtime._scheduler",
        None,
    )

    result = read_ports.cancel_background_work_item("c1")
    assert result["status"] == "cancelled"
    # Flag stays until a handler acknowledges; durable row is authoritative.
    assert is_execution_cancelled("exec_c1")
    assert peek_plan_resume("apr_c1", db=kernel._db) is None
    configure_plan_resume_db(None)


@pytest.mark.asyncio
async def test_cancel_before_handler_keeps_cancelled_status(kernel, monkeypatch):
    """Cancel arrives before handler acquires the row — status must stay cancelled.

    Regression for the cancel-vs-running race: handler entry previously promoted
    any non-running status to ``running``, clobbering a durable ``cancelled``.
    """
    from app.core.runtime.execution import (
        ExecutionContext,
        request_cancel_execution,
    )
    from app.core.runtime.handlers import execute_handlers as mod
    from app.core.runtime.kernel.event import Event

    _create_running(kernel, "race1")
    # Durable cancel + in-process flag both set (cancel API semantics).
    kernel.emit_event(
        "WorkItemStatusChanged", "work_item", "race1",
        payload={"status": "cancelled"}, actor="user",
    )
    request_cancel_execution("exec_race1")

    evt = Event(
        type="ExecuteRequested",
        aggregate_type="action",
        aggregate_id="exec_race1",
        payload={"action_id": "race1"},
        actor="background",
    ).with_seq(99)
    ctx = ExecutionContext(
        instance_id="runtime:primary",
        actor="background",
        correlation_id="",
        _kernel=kernel,
        execution_id="exec_race1",
    )

    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    await mod.on_execute_requested(ctx, evt)

    rows = kernel.query_state("work_items", id="race1", limit=1)
    assert rows[0]["status"] == "cancelled", (
        "handler must not promote a cancelled row back to running"
    )
    assert not is_execution_cancelled("exec_race1"), "flag must be cleared"


def _failed_status_events(kernel, work_id: str) -> list:
    return [
        event
        for event in kernel.read_events(
            type="WorkItemStatusChanged",
            aggregate_id=work_id,
        )
        if (event.payload or {}).get("status") == "failed"
    ]


def _pending_execute_execution(kernel, trigger, *, max_retries: int = 0):
    from app.core.runtime.scheduled_execution import ExecutionPolicy, ScheduledExecution

    return ScheduledExecution(
        event_id=trigger.id,
        event_seq=trigger.seq or 0,
        event_type="ExecuteRequested",
        handler_name="on_execute_requested",
        instance_id="runtime:primary",
        policy=ExecutionPolicy(
            timeout_seconds=0.05,
            max_retries=max_retries,
            retry_delay_seconds=0,
        ),
        _event=trigger,
    )


def _seed_running_execute(kernel, trigger, *, max_retries: int, retry_count: int = 0):
    """Project a running handler for ``trigger`` without constructing Scheduler."""
    from app.core.runtime.execution_events import (
        emit_execution_requested,
        emit_execution_retried,
        emit_execution_started,
    )

    item = _pending_execute_execution(kernel, trigger, max_retries=max_retries)
    emit_execution_requested(kernel, item, "user")
    item.transition_to("running")
    emit_execution_started(kernel, item)
    if retry_count:
        item.retry_count = retry_count
        item.transition_to("retrying")
        emit_execution_retried(kernel, item, reason="boom", status="retrying")
        item.transition_to("pending")
        emit_execution_retried(kernel, item, reason="boom", status="pending")
        item.transition_to("running")
        emit_execution_started(kernel, item)
    return item


@pytest.mark.asyncio
async def test_timeout_dead_letter_closes_running_work(kernel):
    """Handler timeout with no retries left fails the work item immediately."""
    import asyncio

    from app.core.runtime.agent_scheduler import Scheduler
    from app.core.runtime.execution_events import emit_execution_requested

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "live-timeout")
    item = _pending_execute_execution(kernel, trigger, max_retries=0)
    emit_execution_requested(kernel, item, "user")

    async def hang(_item, _event):
        await asyncio.sleep(30)

    sch._execute_handler = hang
    await sch._process_work_item(item)

    assert kernel.query_state("work_items", id="live-timeout", limit=1)[0]["status"] == "failed"
    handler = kernel.read_scheduled_execution(item.id)
    assert handler is not None
    assert handler.status == "failed"
    assert handler.dead_letter is True
    assert kernel.read_events(type="ExecutionRetried", aggregate_id=item.id) == []
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_live-timeout")) == 1
    failed = _failed_status_events(kernel, "live-timeout")
    assert len(failed) == 1
    assert failed[0].actor == "kernel"
    assert str(failed[0].payload.get("error") or "").startswith("Timeout after")


@pytest.mark.asyncio
async def test_timeout_with_retries_left_leaves_work_running(kernel):
    import asyncio

    from app.core.runtime.agent_scheduler import Scheduler
    from app.core.runtime.execution_events import emit_execution_requested

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "live-retry")
    item = _pending_execute_execution(kernel, trigger, max_retries=1)
    emit_execution_requested(kernel, item, "user")

    async def hang(_item, _event):
        await asyncio.sleep(30)

    sch._execute_handler = hang
    await sch._process_work_item(item)

    assert kernel.query_state("work_items", id="live-retry", limit=1)[0]["status"] == "running"
    handler = kernel.read_scheduled_execution(item.id)
    assert handler is not None
    assert handler.dead_letter is False
    assert handler.status == "pending"
    assert _failed_status_events(kernel, "live-retry") == []
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_live-retry")) == 1


@pytest.mark.asyncio
async def test_retry_budget_dead_letter_closes_running_work(kernel):
    from app.core.runtime.agent_scheduler import Scheduler

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "budget")
    item = _seed_running_execute(kernel, trigger, max_retries=1, retry_count=1)
    item.error = "boom"
    await sch._maybe_retry(item)

    assert kernel.query_state("work_items", id="budget", limit=1)[0]["status"] == "failed"
    handler = kernel.read_scheduled_execution(item.id)
    assert handler is not None
    assert handler.dead_letter is True
    assert handler.retry_count == 1
    failed = _failed_status_events(kernel, "budget")
    assert len(failed) == 1
    assert failed[0].payload.get("error") == "boom"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_budget")) == 1


@pytest.mark.asyncio
async def test_dead_letter_waits_for_sibling_handler(kernel):
    from app.core.runtime.agent_scheduler import Scheduler

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "siblings")
    first = _seed_running_execute(kernel, trigger, max_retries=0)
    second = _seed_running_execute(kernel, trigger, max_retries=0)
    first.error = "boom"
    await sch._maybe_retry(first)

    assert kernel.query_state("work_items", id="siblings", limit=1)[0]["status"] == "running"
    assert _failed_status_events(kernel, "siblings") == []

    second.error = "boom"
    await sch._maybe_retry(second)
    assert kernel.query_state("work_items", id="siblings", limit=1)[0]["status"] == "failed"
    assert len(_failed_status_events(kernel, "siblings")) == 1


@pytest.mark.asyncio
async def test_stale_execute_dead_letter_does_not_close_newer_run(kernel):
    from app.core.runtime.agent_scheduler import Scheduler

    sch = Scheduler(kernel)
    older = _running_with_execute(kernel, "newer-run")
    newer = kernel.emit_event(
        "ExecuteRequested", "action", "exec_newer-run",
        payload={"action_id": "newer-run"}, actor="user",
    )
    _seed_running_execute(kernel, newer, max_retries=1)
    stale = _seed_running_execute(kernel, older, max_retries=0)
    stale.error = "boom"
    await sch._maybe_retry(stale)

    assert kernel.query_state("work_items", id="newer-run", limit=1)[0]["status"] == "running"
    assert _failed_status_events(kernel, "newer-run") == []


@pytest.mark.asyncio
async def test_non_execute_dead_letter_leaves_work_running(kernel):
    from app.core.runtime.agent_scheduler import Scheduler
    from app.core.runtime.execution_events import (
        emit_execution_requested,
        emit_execution_started,
    )
    from app.core.runtime.scheduled_execution import ExecutionPolicy, ScheduledExecution

    sch = Scheduler(kernel)
    _running_with_execute(kernel, "beside")
    item = ScheduledExecution(
        event_type="TimerFired",
        event_id="timer-1",
        handler_name="on_timer",
        policy=ExecutionPolicy(max_retries=0, retry_delay_seconds=0),
    )
    emit_execution_requested(kernel, item, "scheduler")
    item.transition_to("running")
    emit_execution_started(kernel, item)
    item.error = "timeout"
    await sch._maybe_retry(item)

    assert kernel.query_state("work_items", id="beside", limit=1)[0]["status"] == "running"
    assert kernel.read_scheduled_execution(item.id).dead_letter is True


def test_reclaim_terminal_lease_closes_running_work(kernel):
    from datetime import UTC, datetime, timedelta

    from app.core.runtime.agent_scheduler import Scheduler

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "lease-dead")
    item = _seed_running_execute(kernel, trigger, max_retries=0)
    old = (datetime.now(UTC) - timedelta(seconds=3600)).isoformat()
    with kernel._db.get_db() as conn:
        conn.execute(
            "UPDATE handler_executions SET started_at = ? WHERE id = ?",
            (old, item.id),
        )

    assert sch.reclaim_stale_leases(60) == 1
    assert kernel.query_state("work_items", id="lease-dead", limit=1)[0]["status"] == "failed"
    handler = kernel.read_scheduled_execution(item.id)
    assert handler is not None
    assert handler.dead_letter is True
    assert handler.error == "timeout"
    assert all(pending.id != item.id for pending in sch._pending)
    failed = _failed_status_events(kernel, "lease-dead")
    assert len(failed) == 1
    assert failed[0].payload.get("error") == "timeout"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_lease-dead")) == 1


def test_reclaim_with_retries_left_leaves_work_running(kernel):
    from datetime import UTC, datetime, timedelta

    from app.core.runtime.agent_scheduler import Scheduler

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "lease-retry")
    item = _seed_running_execute(kernel, trigger, max_retries=2)
    old = (datetime.now(UTC) - timedelta(seconds=3600)).isoformat()
    with kernel._db.get_db() as conn:
        conn.execute(
            "UPDATE handler_executions SET started_at = ? WHERE id = ?",
            (old, item.id),
        )

    assert sch.reclaim_stale_leases(60) == 1
    assert kernel.query_state("work_items", id="lease-retry", limit=1)[0]["status"] == "running"
    handler = kernel.read_scheduled_execution(item.id)
    assert handler is not None
    assert handler.dead_letter is False
    assert handler.status == "pending"
    assert _failed_status_events(kernel, "lease-retry") == []


def test_scheduler_recover_dead_letter_closes_work_immediately(kernel, monkeypatch):
    from app.core.runtime.agent_scheduler import Scheduler
    from app.core.runtime.runtime_loop import RuntimeLoop

    trigger = _running_with_execute(kernel, "boot-dead")
    _seed_running_execute(kernel, trigger, max_retries=1, retry_count=1)
    Scheduler(kernel)

    assert kernel.query_state("work_items", id="boot-dead", limit=1)[0]["status"] == "failed"
    failed = _failed_status_events(kernel, "boot-dead")
    assert len(failed) == 1
    assert failed[0].payload.get("error") == "interrupted"
    assert len(kernel.read_events(type="ExecuteRequested", aggregate_id="exec_boot-dead")) == 1

    _patch_kernel(monkeypatch, kernel)
    assert RuntimeLoop()._recover_interrupted_background_tasks() == 0
    assert len(_failed_status_events(kernel, "boot-dead")) == 1


def test_cancel_does_not_close_running_work(kernel):
    from app.core.runtime.agent_scheduler import Scheduler
    from app.core.runtime.execution_events import emit_execution_requested

    sch = Scheduler(kernel)
    trigger = _running_with_execute(kernel, "cancel-live")
    item = _pending_execute_execution(kernel, trigger, max_retries=0)
    emit_execution_requested(kernel, item, "user")
    sch._pending.append(item)

    assert sch.request_cancel(item.id) is True
    assert kernel.query_state("work_items", id="cancel-live", limit=1)[0]["status"] == "running"
    handler = kernel.read_scheduled_execution(item.id)
    assert handler is not None
    assert handler.status == "failed"
    assert handler.dead_letter is False
    assert _failed_status_events(kernel, "cancel-live") == []
