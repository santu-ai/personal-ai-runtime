"""ExecuteRequested compiles a project-brief delivery after source steps."""

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
async def test_execute_handler_publishes_brief_before_completed(monkeypatch):
    emitted: list[tuple] = []
    compiled: list[tuple] = []

    class Ctx:
        execution_id = "ex-brief"
        correlation_id = "c-brief"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    plan = (
        '{"kind":"project_brief","contract":{"output_kind":"project_brief"},'
        '"steps":[{"tool":"echo","params":{"t":"1"}}]}'
    )
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": "brief_1",
            "status": "running",
            "title": "Brief",
            "parent_work_id": None,
            "executable_plan": plan,
        },
    )
    monkeypatch.setattr(
        "app.core.runtime.kernel_instance.kernel",
        MagicMock(
            invoke_capability=AsyncMock(
                return_value={"status": "success", "result": '{"ok":true}'},
            ),
        ),
    )

    async def _compile(work_id, outcome, **kwargs):
        compiled.append((work_id, [r.result for r in outcome.results], kwargs))
        return {"ok": True, "qualified": True}

    from app.core.runtime.runtime_container import runtime

    prev = runtime.work_delivery_compiler
    runtime.bind_work_delivery_compiler(_compile)
    try:
        event = MagicMock()
        event.id = "evt"
        event.payload = {"action_id": "brief_1"}
        await on_execute_requested(Ctx(), event)
    finally:
        runtime.bind_work_delivery_compiler(prev)

    assert compiled
    assert compiled[0][0] == "brief_1"
    types = [args[0] for args, _ in emitted]
    assert types.count("WorkItemStatusChanged") >= 1
    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "success"


@pytest.mark.asyncio
async def test_execute_handler_fails_on_illegal_brief(monkeypatch):
    emitted: list[tuple] = []

    class Ctx:
        execution_id = "ex-bad"
        correlation_id = "c-bad"

        def emit(self, *args, **kwargs):
            emitted.append((args, kwargs))

    plan = '{"kind":"project_brief","contract":{"output_kind":"project_brief"},"steps":[]}'
    monkeypatch.setattr(
        "app.core.runtime.read_ports.query_work_item",
        lambda _id: {
            "id": "brief_2",
            "status": "running",
            "title": "Brief",
            "parent_work_id": None,
            "executable_plan": plan,
        },
    )

    async def _compile(work_id, outcome, **kwargs):
        return {"ok": False, "error": "模型输出非法或不可用，可重试"}

    from app.core.runtime.runtime_container import runtime

    prev = runtime.work_delivery_compiler
    runtime.bind_work_delivery_compiler(_compile)
    try:
        event = MagicMock()
        event.id = "evt"
        event.payload = {"action_id": "brief_2"}
        await on_execute_requested(Ctx(), event)
    finally:
        runtime.bind_work_delivery_compiler(prev)

    done = next(e for e in emitted if e[0][0] == "ExecuteCompleted")
    assert done[1]["payload"]["status"] == "error"
    wi = [e for e in emitted if e[0][0] == "WorkItemStatusChanged"]
    assert wi[-1][1]["payload"]["status"] == "failed"
