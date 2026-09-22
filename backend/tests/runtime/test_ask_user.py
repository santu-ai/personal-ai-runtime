"""ask_user pauses the chat tool loop and does not replay a cached reply."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.agents.brain_stream_assemble import AssembledStream
from app.core.agents.conversation import ConversationManager
from app.core.runtime.plan_resume import (
    configure_plan_resume_db,
    load_chat_checkpoint,
    record_chat_tool_success,
)


def _fake_llm():
    return SimpleNamespace(
        provider=SimpleNamespace(
            name="fake", model="fake",
            price_per_prompt_token=0, price_per_completion_token=0,
        ),
        create_stream=AsyncMock(return_value=("resp", None, SimpleNamespace(
            name="fake", model="fake",
            price_per_prompt_token=0, price_per_completion_token=0,
        ))),
        replace_provider=lambda *_a, **_k: None,
    )


@pytest.mark.asyncio
async def test_ask_user_checkpoint_replay_does_not_call_llm(isolated_kernel, monkeypatch):
    """A crash while the clarification card is open must not drop it or call the model."""
    k, db = isolated_kernel
    configure_plan_resume_db(db)
    cid = "ask-wait"
    try:
        monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
        monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", k)
        monkeypatch.setattr("app.core.agents.tool_dispatcher.kernel", k, raising=False)

        calls = {"n": 0}

        async def fake_iter(_response):
            calls["n"] += 1
            yield {
                "type": "_stream_assembled",
                "result": AssembledStream(
                    visible_text="",
                    tool_calls=[{
                        "id": "call_ask",
                        "function_name": "ask_user",
                        "arguments": json.dumps({"question": "简报要覆盖最近几天？"}),
                    }],
                ),
            }

        monkeypatch.setattr("app.core.agents.brain_chat_stream.iter_assembled_stream", fake_iter)
        monkeypatch.setattr("app.core.agents.brain_chat_stream.record_llm_call", lambda *a, **_k: 0)

        def build_messages(_conv, user_message, *, system_prompt=""):
            return [
                {"role": "system", "content": system_prompt or "s"},
                {"role": "user", "content": user_message},
            ]

        brain = SimpleNamespace(llm=_fake_llm(), build_messages=build_messages)
        conv = ConversationManager(conversation_id="ask-conv", kernel=k)
        k.emit_event(
            "ConversationCreated", "conversation", "ask-conv",
            payload={"title": "ask"}, actor="user",
        )
        from app.core.agents import brain_chat_stream

        events = []
        async for evt in brain_chat_stream.chat_stream(
            brain, conv, "做简报", system_prompt="s", correlation_id=cid,
        ):
            events.append(evt)

        assert any(
            e.get("type") == "confirmation_required" and e.get("tool_name") == "ask_user"
            for e in events
        )
        ckpt = load_chat_checkpoint(cid, kernel=k)
        assert ckpt is not None
        assert ckpt.get("status") == "awaiting_approval"
        assert ckpt.get("pending_tool_call_ids") == ["call_ask"]
        assert calls["n"] == 1

        replay = []
        async for evt in brain_chat_stream.chat_stream(
            brain, conv, "做简报", system_prompt="s", correlation_id=cid,
        ):
            replay.append(evt)
        assert replay == [{"type": "done"}]
        assert calls["n"] == 1
        again = load_chat_checkpoint(cid, kernel=k)
        assert again is not None
        assert again.get("status") == "awaiting_approval"
    finally:
        configure_plan_resume_db(None)


@pytest.mark.asyncio
async def test_repeated_ask_user_is_not_served_from_write_cache(isolated_kernel):
    k, db = isolated_kernel
    configure_plan_resume_db(db)
    try:
        k.emit_event(
            "ConversationCreated", "conversation", "ask-conv-2",
            payload={"title": "ask"}, actor="user",
        )
        conv = ConversationManager(conversation_id="ask-conv-2", kernel=k)
        record_chat_tool_success(
            "ask-corr",
            "ask_user",
            {"question": "几天？"},
            '{"status":"answered","answer":"三天"}',
            kernel=k,
        )
        from app.core.agents.tool_dispatcher import ToolDispatcher

        dispatcher = ToolDispatcher(kernel=k, conversation=conv)
        events = []
        async for evt in dispatcher.dispatch(
            [{
                "id": "c1",
                "function_name": "ask_user",
                "arguments": json.dumps({"question": "几天？"}),
            }],
            correlation_id="ask-corr",
        ):
            events.append(evt)
        assert any(e.get("type") == "confirmation_required" for e in events)
        assert not any(
            e.get("type") == "tool_result" and "三天" in str(e.get("content"))
            for e in events
        )
    finally:
        configure_plan_resume_db(None)
