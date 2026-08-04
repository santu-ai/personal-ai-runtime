"""InboxPollRequested handler — applier bind, credential scrubbing, JSON parse, success."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.core.runtime.execution import ExecutionContext, Principal
from app.core.runtime.handlers.inbox_poll_handlers import on_inbox_poll_requested
from app.core.runtime.kernel.event import Event
from app.core.runtime.runtime_container import runtime


class _RecordingKernel:
    """Minimal Kernel stand-in: records emit_event + stub invoke_capability."""

    def __init__(self, cap_response: dict[str, Any]):
        self.cap_response = cap_response
        self.invoke_calls: list[dict[str, Any]] = []
        self.emitted: list[dict[str, Any]] = []

    async def invoke_capability(self, name, args, **kwargs):
        self.invoke_calls.append({"name": name, "args": args, **kwargs})
        return self.cap_response

    def emit_event(self, **kwargs):
        self.emitted.append(kwargs)
        return SimpleNamespace(id=f"evt_{len(self.emitted)}", **kwargs)


def _event(*, limit: int | None = None, aggregate_id: str = "poll1") -> Event:
    payload: dict[str, Any] = {}
    if limit is not None:
        payload["limit"] = limit
    return Event(
        type="InboxPollRequested",
        aggregate_type="inbox",
        aggregate_id=aggregate_id,
        payload=payload,
        actor="scheduler",
        id="evt_poll_req",
    )


def _ctx(kernel: _RecordingKernel) -> ExecutionContext:
    return ExecutionContext(
        instance_id="runtime:primary",
        actor="scheduler",
        correlation_id="corr-1",
        _kernel=kernel,  # type: ignore[arg-type]
        principal=Principal.system(),
        execution_id="exec_poll_1",
    )


@pytest.fixture(autouse=True)
def _clear_applier():
    prev = runtime._inbox_poll_applier
    runtime._inbox_poll_applier = None
    yield
    runtime._inbox_poll_applier = prev


@pytest.mark.asyncio
async def test_applier_unbound_emits_error(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": {}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert len(kernel.emitted) == 1
    out = kernel.emitted[0]
    assert out["type"] == "InboxPollCompleted"
    assert out["payload"]["status"] == "error"
    assert out["payload"]["error"] == "inbox poll applier not bound"
    assert out["payload"]["new_count"] == 0
    assert out["caused_by"] == "evt_poll_req"
    assert kernel.invoke_calls == []


@pytest.mark.asyncio
async def test_capability_failure_emits_error(monkeypatch):
    kernel = _RecordingKernel({"status": "error", "error": "check_inbox failed"})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        raise AssertionError("applier must not run on capability failure")

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert kernel.emitted[0]["payload"]["status"] == "error"
    assert kernel.emitted[0]["payload"]["error"] == "check_inbox failed"


@pytest.mark.asyncio
async def test_email_credential_error_is_scrubbed(monkeypatch):
    kernel = _RecordingKernel(
        {"status": "error", "error": "missing EMAIL_USER or EMAIL_PASS"},
    )
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    runtime.bind_inbox_poll_applier(lambda *_a, **_k: {"status": "ok"})

    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert kernel.emitted[0]["payload"]["error"] == "Email credentials not configured"


@pytest.mark.asyncio
async def test_json_string_result_is_parsed_before_apply(monkeypatch):
    kernel = _RecordingKernel(
        {"status": "success", "result": '{"emails": [{"id": "e1"}]}'},
    )
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    seen: list[Any] = []

    async def _apply(result, **kwargs):
        seen.append(result)
        return {"status": "success", "new_count": 1}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert seen == [{"emails": [{"id": "e1"}]}]
    assert kernel.emitted[0]["payload"]["status"] == "success"
    assert kernel.emitted[0]["payload"]["new_count"] == 1


@pytest.mark.asyncio
async def test_invalid_json_string_becomes_empty_dict(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": "not-json{"})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    seen: list[Any] = []

    async def _apply(result, **kwargs):
        seen.append(result)
        return {"status": "success", "new_count": 0}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert seen == [{}]


@pytest.mark.asyncio
async def test_applier_error_emits_error(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": {"emails": []}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "error", "error": "imap timeout"}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())

    out = kernel.emitted[0]["payload"]
    assert out["status"] == "error"
    assert out["error"] == "imap timeout"
    assert out["new_count"] == 0


@pytest.mark.asyncio
async def test_success_passthrough_new_count(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": {"emails": [1, 2]}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "success", "new_count": 2, "categories": {"important": 1}}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event(limit=5))

    out = kernel.emitted[0]
    assert out["type"] == "InboxPollCompleted"
    assert out["payload"]["status"] == "success"
    assert out["payload"]["new_count"] == 2
    assert out["payload"]["categories"] == {"important": 1}


@pytest.mark.asyncio
async def test_limit_floored_to_at_least_100(monkeypatch):
    """Handler passes max(limit, 100) to check_inbox regardless of request limit."""
    kernel = _RecordingKernel({"status": "success", "result": {}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "success", "new_count": 0}

    runtime.bind_inbox_poll_applier(_apply)

    await on_inbox_poll_requested(_ctx(kernel), _event(limit=5))
    assert kernel.invoke_calls[0]["args"]["limit"] == 100

    kernel.invoke_calls.clear()
    await on_inbox_poll_requested(_ctx(kernel), _event(limit=150))
    assert kernel.invoke_calls[0]["args"]["limit"] == 150


@pytest.mark.asyncio
async def test_default_limit_when_payload_omits_it(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": {}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "success", "new_count": 0}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())  # no limit key

    # default limit=20 → max(20, 100) = 100
    assert kernel.invoke_calls[0]["args"]["limit"] == 100
    assert kernel.invoke_calls[0]["args"]["unread_only"] is True
    assert kernel.invoke_calls[0]["name"] == "check_inbox"
    assert kernel.invoke_calls[0]["execution_id"] == "exec_poll_1"
