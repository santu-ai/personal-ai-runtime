"""Tests for shared plan runner and approval resume dispatch."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.runtime.handlers.plan_runner import parse_plan_steps, run_plan_steps
from app.core.runtime.plan_resume import (
    PlanResume,
    clear_plan_resumes,
    configure_plan_resume_db,
    peek_plan_resume,
    record_step_success,
    register_plan_resume,
    take_plan_resume,
)
from app.store.database import Database


@pytest.fixture(autouse=True)
def _clear_resumes(tmp_path):
    db = Database(db_path=str(tmp_path / "plan_resume.db"))
    configure_plan_resume_db(db)
    clear_plan_resumes()
    yield db
    clear_plan_resumes()
    configure_plan_resume_db(None)


def test_parse_plan_steps_rejects_bad_json():
    with pytest.raises(ValueError, match="invalid plan JSON"):
        parse_plan_steps("{not-json")


def test_parse_plan_steps_ok():
    steps = parse_plan_steps('{"steps": [{"tool": "web_search", "params": {"query": "x"}}]}')
    assert len(steps) == 1
    assert steps[0]["tool"] == "web_search"


@pytest.mark.asyncio
async def test_run_plan_steps_success_and_resume_from():
    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock(
        side_effect=[
            {"status": "success", "result": "a"},
            {"status": "success", "result": "b"},
        ]
    )
    steps = [
        {"tool": "t1", "params": {}},
        {"tool": "t2", "params": {}},
    ]
    outcome = await run_plan_steps(
        steps=steps,
        kernel=kernel,
        actor="executor",
        execution_id="ex1",
        correlation_id="c1",
        resume_from=1,
    )
    assert outcome.stopped_reason == "completed"
    assert outcome.completed_steps == 1
    assert kernel.invoke_capability.await_count == 1
    assert kernel.invoke_capability.await_args.kwargs["name"] == "t2"


@pytest.mark.asyncio
async def test_run_plan_steps_hydrates_cached_prefix_without_replay():
    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock(
        return_value={"status": "success", "result": "should-not-run"},
    )
    steps = [
        {"tool": "check_inbox", "params": {}},
        {"tool": "read_file", "params": {"path": "a.md"}},
    ]
    inbox_body = '{"emails":[{"message_id":"m1","subject":"ok"}]}'
    file_body = "file body from first pass"
    record_step_success("old-corr", 0, inbox_body, action_id="work-resume")
    record_step_success("old-corr", 1, file_body, action_id="work-resume")

    outcome = await run_plan_steps(
        steps=steps,
        kernel=kernel,
        actor="executor",
        execution_id="ex-new",
        correlation_id="new-corr",
        resume_from=2,
        action_id="work-resume",
    )
    assert outcome.stopped_reason == "completed"
    assert [(r.step, r.tool, r.result) for r in outcome.results] == [
        (0, "check_inbox", inbox_body),
        (1, "read_file", file_body),
    ]
    assert kernel.invoke_capability.await_count == 0


@pytest.mark.asyncio
async def test_run_plan_steps_missing_tool_fails():
    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock()
    outcome = await run_plan_steps(
        steps=[{"params": {"query": "x"}}],
        kernel=kernel,
        actor="background",
        execution_id="ex1",
        correlation_id=None,
    )
    assert outcome.stopped_reason == "failed"
    kernel.invoke_capability.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_plan_steps_failed_status_stops():
    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock(
        return_value={"status": "error", "error": "denied"}
    )
    outcome = await run_plan_steps(
        steps=[{"tool": "shell_exec", "params": {"command": "ls"}}],
        kernel=kernel,
        actor="background",
        execution_id="ex1",
        correlation_id=None,
    )
    assert outcome.stopped_reason == "failed"
    assert outcome.results[0].status == "failed"


@pytest.mark.asyncio
async def test_run_plan_steps_pending_registers_via_factory():
    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock(
        return_value={"status": "pending", "approval_id": "apr_1"}
    )
    outcome = await run_plan_steps(
        steps=[
            {"tool": "write_file", "params": {"path": "/a", "content": "x"}},
            {"tool": "web_search", "params": {"query": "y"}},
        ],
        kernel=kernel,
        actor="executor",
        execution_id="ex1",
        correlation_id="c1",
        resume_factory=lambda o: PlanResume(
            kind="execute",
            resume_from=o.next_resume_from or 0,
            previous_output=o.previous_output,
            action_id="act1",
        ),
    )
    assert outcome.stopped_reason == "pending"
    assert outcome.next_resume_from == 1
    got = peek_plan_resume("apr_1")
    assert got is not None
    assert got.action_id == "act1"
    assert got.resume_from == 1


def test_plan_resume_with_step_output():
    resume = PlanResume(kind="execute", resume_from=1, action_id="a")
    updated = resume.with_step_output(0, "approved-result")
    assert updated.previous_output == {"step_0_output": "approved-result"}


@pytest.mark.asyncio
async def test_approve_dispatches_execute_resume_with_step_output(monkeypatch):
    from app.core.runtime.handlers import approve_handlers as mod

    register_plan_resume(
        "apr_resume",
        PlanResume(
            kind="execute",
            resume_from=1,
            action_id="act_99",
            previous_output={},
        ),
    )

    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex"
        correlation_id = "corr"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    async def fake_invoke(**kwargs):
        return {"status": "success", "result": "written-ok"}

    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(side_effect=fake_invoke),
            deny_approval=MagicMock(),
        ),
    )

    event = MagicMock()
    event.id = "evt1"
    event.payload = {
        "approval_id": "apr_resume",
        "decision": "approve",
        "tool_name": "write_file",
        "tool_args": {"path": "/a", "content": "x"},
        "conv_id": "",
        "tool_call_id": "",
    }

    await mod.on_approve_requested(Ctx(), event)

    resume_emits = [e for e in emitted if e[0] and e[0][0] == "ExecuteRequested"]
    assert len(resume_emits) == 1
    payload = resume_emits[0][1]["payload"]
    assert payload["action_id"] == "act_99"
    assert payload["resume_from"] == 1
    assert payload["previous_output"]["step_0_output"] == "written-ok"
    assert take_plan_resume("apr_resume") is None


@pytest.mark.asyncio
async def test_approve_keeps_resume_when_dispatch_fails(monkeypatch):
    from app.core.runtime.handlers import approve_handlers as mod

    register_plan_resume(
        "apr_keep",
        PlanResume(kind="execute", resume_from=1, action_id="act_1"),
    )

    class Ctx:
        execution_id = "ex"
        correlation_id = "corr"

        def emit(self, *args, **kwargs):
            if args and args[0] == "ExecuteRequested":
                raise RuntimeError("emit failed")
            # ApproveCompleted still emitted

    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "success", "result": "ok"}
            ),
        ),
    )

    event = MagicMock()
    event.id = "evt1"
    event.payload = {
        "approval_id": "apr_keep",
        "decision": "approve",
        "tool_name": "write_file",
        "tool_args": {},
        "conv_id": "",
        "tool_call_id": "",
    }

    await mod.on_approve_requested(Ctx(), event)
    kept = peek_plan_resume("apr_keep")
    assert kept is not None
    assert kept.previous_output == {"step_0_output": "ok"}


@pytest.mark.asyncio
async def test_approve_persists_full_result_for_resume_hydration(monkeypatch):
    from app.core.runtime.handlers import approve_handlers as mod
    from app.core.runtime.plan_resume import lookup_action_step_success

    body = "approved-source-body-" + ("x" * 1200)
    register_plan_resume(
        "apr_src",
        PlanResume(kind="execute", resume_from=1, action_id="brief_src", previous_output={}),
    )
    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex"
        correlation_id = "corr-approve"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    invoke = AsyncMock(return_value={"status": "success", "result": body})
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(invoke_capability=invoke, deny_approval=MagicMock()),
    )
    event = MagicMock()
    event.id = "evt-src"
    event.payload = {
        "approval_id": "apr_src",
        "decision": "approve",
        "tool_name": "read_file",
        "tool_args": {"path": "a.md"},
        "conv_id": "",
        "tool_call_id": "",
    }
    await mod.on_approve_requested(Ctx(), event)

    cached = lookup_action_step_success("brief_src", 0)
    assert cached == body
    resume_emits = [e for e in emitted if e[0] and e[0][0] == "ExecuteRequested"]
    assert len(resume_emits) == 1
    payload = resume_emits[0][1]["payload"]
    assert payload["resume_from"] == 1
    assert len(payload["previous_output"]["step_0_output"]) == 1000

    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock(
        return_value={"status": "success", "result": "should-not-run"},
    )
    outcome = await run_plan_steps(
        steps=[{"tool": "read_file", "params": {"path": "a.md"}}],
        kernel=kernel,
        actor="executor",
        execution_id="ex-resume",
        correlation_id="new-corr",
        resume_from=int(payload["resume_from"]),
        previous_output=payload.get("previous_output"),
        action_id=str(payload["action_id"]),
    )
    assert outcome.stopped_reason == "completed"
    assert outcome.results
    assert outcome.results[0].result == body
    assert kernel.invoke_capability.await_count == 0


@pytest.mark.asyncio
async def test_approve_skips_tool_replay_after_save_before_dispatch(monkeypatch):
    from app.core.runtime.handlers import approve_handlers as mod

    body = "full-approved-body-" + ("y" * 800)
    register_plan_resume(
        "apr_gap",
        PlanResume(kind="execute", resume_from=1, action_id="act_gap"),
    )
    invoke = AsyncMock(return_value={"status": "success", "result": body})

    class FailingCtx:
        execution_id = "ex"
        correlation_id = "corr-gap"

        def emit(self, *args, **kwargs):
            if args and args[0] == "ExecuteRequested":
                raise RuntimeError("emit failed")

    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(invoke_capability=invoke, deny_approval=MagicMock()),
    )
    event = MagicMock()
    event.id = "evt-gap"
    event.payload = {
        "approval_id": "apr_gap",
        "decision": "approve",
        "tool_name": "read_file",
        "tool_args": {"path": "a.md"},
        "conv_id": "",
        "tool_call_id": "",
    }
    await mod.on_approve_requested(FailingCtx(), event)
    assert peek_plan_resume("apr_gap") is not None
    assert invoke.await_count == 1

    emitted: list[tuple] = []

    class OkCtx:
        execution_id = "ex"
        correlation_id = "corr-gap"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    await mod.on_approve_requested(OkCtx(), event)
    assert invoke.await_count == 1
    assert any(e[0] and e[0][0] == "ExecuteRequested" for e in emitted)

    kernel = MagicMock()
    kernel.invoke_capability = AsyncMock()
    outcome = await run_plan_steps(
        steps=[{"tool": "read_file", "params": {"path": "a.md"}}],
        kernel=kernel,
        actor="executor",
        execution_id="ex2",
        correlation_id="other",
        resume_from=1,
        action_id="act_gap",
    )
    assert outcome.results[0].result == body
    kernel.invoke_capability.assert_not_awaited()


def test_plan_resume_survives_process_restart(tmp_path):
    """APP_STORAGE rows remain after dropping the in-process db binding.

    Simulates restart: register on DB file A, re-open the same path with a
    fresh Database + clear override, then peek must still resolve.
    """
    db_path = str(tmp_path / "durable_resume.db")
    db1 = Database(db_path=db_path)
    configure_plan_resume_db(db1)
    register_plan_resume(
        "apr_dur",
        PlanResume(
            kind="execute",
            resume_from=2,
            action_id="bg_1",
            previous_output={"step_0_output": "x"},
        ),
    )
    configure_plan_resume_db(None)

    db2 = Database(db_path=db_path)
    configure_plan_resume_db(db2)
    got = peek_plan_resume("apr_dur")
    assert got is not None
    assert got.kind == "execute"
    assert got.resume_from == 2
    assert got.action_id == "bg_1"
    assert got.previous_output == {"step_0_output": "x"}
    assert take_plan_resume("apr_dur") is not None
    assert peek_plan_resume("apr_dur") is None
