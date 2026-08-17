"""InboxPollRequested handler — applier bind, credential scrubbing, JSON parse, success."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.runtime.execution import ExecutionContext, Principal
from app.core.runtime.handlers.inbox_poll_handlers import on_inbox_poll_requested
from app.core.runtime.kernel.event import Event
from app.core.runtime.runtime_container import runtime

_INBOX_POLL_LOGGER = "app.core.runtime.handlers.inbox_poll_handlers"


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


def _event(
    *,
    limit: int | None = None,
    aggregate_id: str = "poll1",
    after_uid: int | None = None,
    uid_validity: str | None = None,
) -> Event:
    payload: dict[str, Any] = {}
    if limit is not None:
        payload["limit"] = limit
    if after_uid is not None:
        payload["after_uid"] = after_uid
    if uid_validity is not None:
        payload["uid_validity"] = uid_validity
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


@pytest.fixture
def inbox_poll_log_records() -> Iterator[list[logging.LogRecord]]:
    """Capture WARNING+ on the handler logger without depending on suite order.

    Production ``configure_logging()`` installs a ProcessorFormatter on root
    that mutates LogRecord in place, so pytest ``caplog.text`` is not stable
    once any earlier test (or ``app.main`` import) has configured logging.
    Attach a private handler, freeze level/propagate, then restore.
    """
    log = logging.getLogger(_INBOX_POLL_LOGGER)
    prev_level = log.level
    prev_propagate = log.propagate
    prev_disabled = log.disabled
    prev_handlers = list(log.handlers)
    records: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = _Capture(level=logging.WARNING)
    log.handlers = [handler]
    log.setLevel(logging.WARNING)
    log.propagate = False
    log.disabled = False
    try:
        yield records
    finally:
        log.removeHandler(handler)
        handler.close()
        log.handlers = prev_handlers
        log.setLevel(prev_level)
        log.propagate = prev_propagate
        log.disabled = prev_disabled


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
    assert kernel.emitted[0]["payload"]["error_kind"] == "other"


def _logged_messages(records: list[logging.LogRecord]) -> str:
    return "\n".join(record.getMessage() for record in records)


@pytest.mark.asyncio
async def test_capability_failure_is_logged(monkeypatch, inbox_poll_log_records):
    kernel = _RecordingKernel({"status": "error", "error": "check_inbox failed"})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
    runtime.bind_inbox_poll_applier(lambda *_a, **_k: {"status": "ok"})

    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert "Inbox poll failed: check_inbox failed" in _logged_messages(
        inbox_poll_log_records,
    )


@pytest.mark.asyncio
async def test_capability_failure_is_logged_after_production_config(
    monkeypatch, inbox_poll_log_records,
):
    """Business logger capture must survive production logging setup."""
    from app.core.logging_config import configure_logging

    root = logging.getLogger()
    prev_handlers = list(root.handlers)
    prev_level = root.level
    configure_logging()
    try:
        kernel = _RecordingKernel({"status": "error", "error": "IMAP timeout"})
        monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)
        runtime.bind_inbox_poll_applier(lambda *_a, **_k: {"status": "ok"})

        await on_inbox_poll_requested(_ctx(kernel), _event())

        assert "Inbox poll failed: IMAP timeout" in _logged_messages(
            inbox_poll_log_records,
        )
    finally:
        for handler in list(root.handlers):
            if handler not in prev_handlers:
                root.removeHandler(handler)
                handler.close()
        for handler in prev_handlers:
            if handler not in root.handlers:
                root.addHandler(handler)
        root.setLevel(prev_level)


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
async def test_invalid_json_string_emits_error(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": "not-json{"})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        raise AssertionError("applier must not run on invalid JSON")

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())

    out = kernel.emitted[0]["payload"]
    assert out["status"] == "error"
    assert kernel.emitted[0]["payload"]["error"] == "invalid inbox JSON"
    assert kernel.emitted[0]["payload"]["error_kind"] == "json"


@pytest.mark.asyncio
async def test_non_dict_result_emits_error(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": ["emails"]})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        raise AssertionError("applier must not run on non-dict result")

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())

    assert kernel.emitted[0]["payload"]["error"] == "invalid inbox JSON"


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
async def test_limit_capped_at_20_recent(monkeypatch):
    """Handler fetches recent mail (including read), capped at 20 bodies."""
    kernel = _RecordingKernel({"status": "success", "result": {}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "success", "new_count": 0}

    runtime.bind_inbox_poll_applier(_apply)

    await on_inbox_poll_requested(_ctx(kernel), _event(limit=5))
    assert kernel.invoke_calls[0]["args"]["limit"] == 5
    assert kernel.invoke_calls[0]["args"]["unread_only"] is False
    kernel.invoke_calls.clear()
    await on_inbox_poll_requested(_ctx(kernel), _event(limit=150))
    assert kernel.invoke_calls[0]["args"]["limit"] == 20
    assert kernel.invoke_calls[0]["args"]["unread_only"] is False


@pytest.mark.asyncio
async def test_uid_cursor_is_forwarded_to_check_inbox(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": {}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "success", "new_count": 0}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(
        _ctx(kernel),
        _event(limit=5, after_uid=42, uid_validity="uid-7"),
    )

    assert kernel.invoke_calls[0]["args"]["after_uid"] == 42
    assert kernel.invoke_calls[0]["args"]["uid_validity"] == "uid-7"


@pytest.mark.asyncio
async def test_default_limit_when_payload_omits_it(monkeypatch):
    kernel = _RecordingKernel({"status": "success", "result": {}})
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", kernel)

    async def _apply(_result, **_kwargs):
        return {"status": "success", "new_count": 0}

    runtime.bind_inbox_poll_applier(_apply)
    await on_inbox_poll_requested(_ctx(kernel), _event())  # no limit key

    # default limit=20, unread_only=false so already-read mail still syncs
    assert kernel.invoke_calls[0]["args"]["limit"] == 20
    assert kernel.invoke_calls[0]["args"]["unread_only"] is False
    assert kernel.invoke_calls[0]["name"] == "check_inbox"
    assert kernel.invoke_calls[0]["execution_id"] == "exec_poll_1"
