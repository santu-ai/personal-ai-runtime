"""Telegram tool and Product gateway contracts."""

import asyncio
import json
from unittest.mock import AsyncMock

import pytest


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _Client:
    def __init__(self, payload):
        self.payload = payload
        self.params = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, _url, *, params):
        self.params = params
        return _Response(self.payload)


@pytest.mark.asyncio
async def test_telegram_updates_use_offset_and_filter_chat(monkeypatch):
    from app.core.harness.builtin_tools import telegram_bot as module

    monkeypatch.setattr(module.settings, "telegram_bot_token", "secret-token")
    monkeypatch.setattr(module.settings, "telegram_chat_id", "42")
    client = _Client({
        "ok": True,
        "result": [
            {"update_id": 10, "message": {"chat": {"id": 7}, "text": "ignored"}},
            {
                "update_id": 11,
                "message": {
                    "chat": {"id": 42},
                    "from": {"first_name": "A"},
                    "text": "hello",
                    "date": 123,
                },
            },
        ],
    })
    monkeypatch.setattr(
        module,
        "create_ssrf_safe_async_client",
        lambda **_kwargs: client,
    )

    result = json.loads(
        await module.telegram_bot_server.get_updates(limit=200, offset=10, timeout=30),
    )

    assert client.params == {"limit": 100, "timeout": 20, "offset": 10}
    assert result["next_offset"] == 12
    assert result["ignored_count"] == 1
    assert result["updates"] == [{
        "update_id": 11,
        "chat_id": "42",
        "from": "A",
        "text": "hello",
        "date": 123,
    }]


@pytest.mark.asyncio
async def test_telegram_send_rejects_non_allowlisted_chat(monkeypatch):
    from app.core.harness.builtin_tools import telegram_bot as module
    from app.core.harness.mcp_hub import ToolInvokeError

    monkeypatch.setattr(module.settings, "telegram_bot_token", "secret-token")
    monkeypatch.setattr(module.settings, "telegram_chat_id", "42")

    with pytest.raises(ToolInvokeError, match="allowlisted"):
        await module.telegram_bot_server.send_message("hello", chat_id="7")


@pytest.mark.asyncio
async def test_gateway_dedupes_updates_and_persists_offset(
    isolated_kernel, monkeypatch,
):
    from app.core.runtime.taint import taint_registry
    from app.product import telegram_gateway as gateway

    k, database = isolated_kernel
    monkeypatch.setattr(gateway, "kernel", k)
    monkeypatch.setattr(gateway, "db", database)
    monkeypatch.setattr(gateway.settings, "telegram_chat_id", "42")
    gateway.save_config({"enabled": True}, audit=False)
    invoke = AsyncMock(return_value={
        "status": "success",
        "result": json.dumps({
            "updates": [{"update_id": 101, "chat_id": "42", "text": "hello"}],
            "next_offset": 102,
        }),
    })
    monkeypatch.setattr(k, "invoke_capability", invoke)

    first = await gateway.poll_once()
    second = await gateway.poll_once()

    assert first["processed"] == 1
    assert second["processed"] == 0
    events = k.read_events(type="ChatRequested", correlation_id="telegram:101")
    assert len(events) == 1
    assert events[0].payload["transport"] == "telegram"
    assert taint_registry.is_tainted("telegram:101")
    assert gateway.load_config()["last_update_id"] == 101
    assert invoke.await_args_list[1].args[1]["offset"] == 102


@pytest.mark.asyncio
async def test_scoped_auto_reply_emits_one_shot_approval(
    isolated_kernel, monkeypatch,
):
    from app.product import telegram_gateway as gateway

    k, database = isolated_kernel
    monkeypatch.setattr(gateway, "kernel", k)
    monkeypatch.setattr(gateway, "db", database)
    monkeypatch.setattr(gateway.settings, "telegram_chat_id", "42")
    gateway.save_config({"enabled": True, "auto_reply": True}, audit=False)
    async def invoke_side_effect(_name, _args, **kwargs):
        k.grant_approval(
            kwargs["approval_id"],
            action="telegram_send",
            actor="user:telegram:42",
            reason="pre_approved",
            correlation_id=kwargs["correlation_id"],
        )
        return {"status": "success", "result": '{"ok": true}'}

    invoke = AsyncMock(side_effect=invoke_side_effect)
    monkeypatch.setattr(k, "invoke_capability", invoke)

    result = await gateway.send_reply("answer", correlation_id="telegram:101")

    assert result["status"] == "success"
    requested = k.read_events(type="ApprovalRequested", correlation_id="telegram:101")
    granted = k.read_events(type="ApprovalGranted", correlation_id="telegram:101")
    assert len(requested) == 1
    assert len(granted) == 1
    assert granted[0].payload["reason"] == "pre_approved"
    kwargs = invoke.await_args.kwargs
    assert kwargs["pre_approved"] is True
    assert kwargs["approval_id"] == requested[0].aggregate_id
    assert invoke.await_args.args[1]["chat_id"] == "42"


@pytest.mark.asyncio
async def test_poll_failure_enters_bounded_backoff(isolated_kernel, monkeypatch):
    from app.product import telegram_gateway as gateway

    k, database = isolated_kernel
    monkeypatch.setattr(gateway, "kernel", k)
    monkeypatch.setattr(gateway, "db", database)
    gateway.save_config({"enabled": True}, audit=False)
    invoke = AsyncMock(return_value={"status": "error", "error": "offline"})
    monkeypatch.setattr(k, "invoke_capability", invoke)

    first = await gateway.poll_once()
    second = await gateway.poll_once()

    assert first["status"] == "error"
    assert second["status"] == "backoff"
    assert gateway.load_config()["consecutive_failures"] == 1
    assert invoke.await_count == 1


@pytest.mark.asyncio
async def test_timer_schedules_telegram_poll_in_background(monkeypatch):
    from app.core.agents.handlers import timer_trigger_handler as module

    poll = AsyncMock(return_value={"status": "ok", "processed": 0})
    monkeypatch.setattr("app.product.telegram_gateway.poll_once", poll)

    await module._handle_telegram_poll({}, None)
    await asyncio.sleep(0)

    poll.assert_awaited_once()


def test_telegram_poll_is_registered_schedule():
    from app.core.runtime.cron_registry import SCHEDULES

    names = {item["name"] for item in SCHEDULES}
    assert "telegram_poll" in names
    expr = next(item["cron_expr"] for item in SCHEDULES if item["name"] == "telegram_poll")
    assert expr == "minute=*/1"


@pytest.mark.asyncio
async def test_in_flight_chat_does_not_advance_offset(isolated_kernel, monkeypatch):
    from app.product import telegram_gateway as gateway

    k, database = isolated_kernel
    monkeypatch.setattr(gateway, "kernel", k)
    monkeypatch.setattr(gateway, "db", database)
    monkeypatch.setattr(gateway.settings, "telegram_chat_id", "42")
    monkeypatch.setattr(
        gateway.read_ports,
        "conversation_chat_in_flight",
        lambda _conv_id: True,
    )
    gateway.save_config({"enabled": True, "last_update_id": 50}, audit=False)
    invoke = AsyncMock(return_value={
        "status": "success",
        "result": json.dumps({
            "updates": [{"update_id": 51, "chat_id": "42", "text": "hello"}],
            "next_offset": 52,
        }),
    })
    monkeypatch.setattr(k, "invoke_capability", invoke)

    result = await gateway.poll_once()

    assert result["processed"] == 0
    assert k.read_events(type="ChatRequested", correlation_id="telegram:51") == []
    assert gateway.load_config()["last_update_id"] == 50
