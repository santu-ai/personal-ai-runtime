"""Tests for ExecuteRequested production path (port + handler status sync)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.runtime.handlers.execute_handlers import on_execute_requested
from app.core.runtime.plan_resume import clear_plan_resumes, configure_plan_resume_db


@pytest.fixture(autouse=True)
def _clear_resumes(tmp_path):
    configure_plan_resume_db(None)
    clear_plan_resumes()
    yield
    clear_plan_resumes()
    configure_plan_resume_db(None)

@pytest.mark.asyncio
async def test_execute_handler_marks_completed_and_emits(monkeypatch):
    emitted: list[tuple] = []
    notified: list[tuple] = []

    class Ctx:
        execution_id = "ex1"
        correlation_id = "c1"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": "act_1",
            "status": "running",
            "title": "Step 1",
            "parent_work_id": "goal_1",
            "executable_plan": '{"steps":[{"tool":"echo","params":{"t":"1"}}]}',
        },
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.bump_parent_activity",
        lambda _gid: notified.append(("bump", _gid)),
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.notify_goal_action_completed",
        lambda *a: notified.append(("notify", a)),
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "success", "result": "ok"}
            ),
        ),
    )

    event = MagicMock()
    event.id = "evt"
    event.payload = {"action_id": "act_1"}

    await on_execute_requested(Ctx(), event)

    types = [args[0] for args, _ in emitted]
    assert "WorkItemStatusChanged" in types
    assert "ExecuteCompleted" in types
    wi = next(e for e in emitted if e[0][0] == "WorkItemStatusChanged")
    assert wi[1]["payload"]["status"] == "completed"
    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "success"
    assert ("bump", "goal_1") in notified
    assert any(n[0] == "notify" for n in notified)


@pytest.mark.asyncio
async def test_execute_handler_waiting_approval_syncs_status(monkeypatch):
    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex1"
        correlation_id = "c1"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": "act_2",
            "status": "waiting_approval",
            "executable_plan": '{"steps":[{"tool":"write_file","params":{}}]}',
        },
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "pending", "approval_id": "apr_x"}
            ),
        ),
    )

    event = MagicMock()
    event.id = "evt"
    event.payload = {"action_id": "act_2"}

    await on_execute_requested(Ctx(), event)

    wi_payloads = [
        e[1]["payload"]["status"]
        for e in emitted
        if e[0][0] == "WorkItemStatusChanged"
    ]
    assert "running" in wi_payloads
    assert "waiting_approval" in wi_payloads


@pytest.mark.asyncio
async def test_execute_handler_keeps_exception_text(monkeypatch):
    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex1"
        correlation_id = "c1"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": "act_err",
            "status": "running",
            "work_type": "task",
            "executable_plan": '{"steps":[{"tool":"read_file","params":{"path":"x"}}]}',
        },
    )

    async def _boom(**_kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(invoke_capability=_boom),
    )

    event = MagicMock()
    event.id = "evt"
    event.payload = {"action_id": "act_err"}

    await on_execute_requested(Ctx(), event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "error"
    assert done[1]["payload"]["error"] == "disk full"
    wi = [e for e in emitted if e[0][0] == "WorkItemStatusChanged"]
    assert wi[-1][1]["payload"]["status"] == "failed"


@pytest.mark.asyncio
async def test_execute_handler_uses_exception_type_when_message_is_blank(monkeypatch):
    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex1"
        correlation_id = "c1"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": "act_blank",
            "status": "running",
            "work_type": "task",
            "executable_plan": '{"steps":[{"tool":"read_file"}]}',
        },
    )

    async def _boom(**_kwargs):
        raise RuntimeError("   ")

    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(invoke_capability=_boom),
    )

    event = MagicMock()
    event.id = "evt"
    event.payload = {"action_id": "act_blank"}

    await on_execute_requested(Ctx(), event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["error"] == "RuntimeError"


def _bind_plan(monkeypatch, action_id: str, plan: str):
    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex1"
        correlation_id = "c1"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": action_id,
            "status": "running",
            "work_type": "task",
            "executable_plan": plan,
        },
    )
    event = MagicMock()
    event.id = "evt"
    event.payload = {"action_id": action_id}
    return Ctx(), event, emitted


@pytest.mark.asyncio
async def test_execute_handler_copies_failed_step_reason(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_tool",
        '{"steps":[{"tool":"shell_exec","params":{"command":"ls"}}]}',
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "error", "error": "forbidden_by_policy"},
            ),
        ),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    payload = done[1]["payload"]
    assert payload["status"] == "error"
    assert payload["error"] == "forbidden_by_policy"
    assert payload["results"][0]["status"] == "failed"
    assert "forbidden_by_policy" in payload["results"][0]["result_preview"]
    wi = [e for e in emitted if e[0][0] == "WorkItemStatusChanged"]
    assert wi[-1][1]["payload"]["status"] == "failed"


@pytest.mark.asyncio
async def test_execute_handler_copies_denied_step_reason(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_denied",
        '{"steps":[{"tool":"write_file","params":{"path":"a"}}]}',
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "denied", "error": "user_denied"},
            ),
        ),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "error"
    assert done[1]["payload"]["error"] == "user_denied"


@pytest.mark.asyncio
async def test_execute_handler_uses_stored_unknown_when_denial_has_no_error(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_unknown",
        '{"steps":[{"tool":"write_file"}]}',
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(return_value={"status": "denied"}),
        ),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["error"] == "unknown"


@pytest.mark.asyncio
async def test_execute_handler_omits_blank_step_error(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_blank_step",
        '{"steps":[{"tool":"read_file"}]}',
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "error", "error": "   "},
            ),
        ),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "error"
    assert "error" not in done[1]["payload"]


@pytest.mark.asyncio
async def test_execute_handler_copies_missing_tool_reason(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_missing",
        '{"steps":[{"params":{"path":"a"}}]}',
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(invoke_capability=AsyncMock()),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["error"] == "missing tool on plan step"


@pytest.mark.asyncio
async def test_execute_handler_uses_the_step_that_stopped_the_plan(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_stop",
        (
            '{"steps":['
            '{"tool":"read_file","continue_on_error":true},'
            '{"tool":"write_file"}'
            ']}'
        ),
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(side_effect=[
                {"status": "error", "error": "skipped"},
                {"status": "denied", "error": "boom"},
            ]),
        ),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "error"
    assert done[1]["payload"]["error"] == "boom"
    assert done[1]["payload"]["completed_steps"] == 0


@pytest.mark.asyncio
async def test_execute_handler_skips_error_when_failed_step_is_continued(monkeypatch):
    ctx, event, emitted = _bind_plan(
        monkeypatch,
        "act_cont",
        (
            '{"steps":['
            '{"tool":"read_file","continue_on_error":true},'
            '{"tool":"write_file"}'
            ']}'
        ),
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(side_effect=[
                {"status": "error", "error": "skipped"},
                {"status": "success", "result": "ok"},
            ]),
        ),
    )

    await on_execute_requested(ctx, event)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "success"
    assert "error" not in done[1]["payload"]
