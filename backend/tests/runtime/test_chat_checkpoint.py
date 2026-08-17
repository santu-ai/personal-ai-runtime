"""Chat tool-loop checkpoint survives a new Kernel on the same sqlite."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.agents.brain_stream_assemble import AssembledStream
from app.core.agents.conversation import ConversationManager
from app.core.harness.mcp_hub import ToolDef, mcp_hub
from app.core.runtime.kernel.kernel import Kernel
from app.core.runtime.plan_resume import (
    clear_chat_checkpoint,
    configure_plan_resume_db,
    load_chat_checkpoint,
    record_chat_checkpoint,
)
from app.core.runtime.taint import taint_registry
from app.store.database import Database


def test_chat_checkpoint_roundtrip_across_kernel(tmp_path):
    db_path = str(tmp_path / "ckpt.db")
    k1 = Kernel(db=Database(db_path=db_path))
    configure_plan_resume_db(k1._db)
    try:
        payload = {
            "conversation_id": "cv1",
            "user_message": "analyze repo",
            "messages": [{"role": "user", "content": "analyze repo"}],
            "iteration": 1,
            "status": "in_progress",
        }
        record_chat_checkpoint("corr-ckpt", payload, kernel=k1)

        k2 = Kernel(db=Database(db_path=db_path))
        configure_plan_resume_db(k2._db)
        loaded = load_chat_checkpoint("corr-ckpt", kernel=k2)
        assert loaded is not None
        assert loaded["iteration"] == 1
        assert loaded["messages"][0]["content"] == "analyze repo"

        clear_chat_checkpoint("corr-ckpt", kernel=k2)
        assert load_chat_checkpoint("corr-ckpt", kernel=k2) is None
    finally:
        configure_plan_resume_db(None)


@pytest.mark.asyncio
async def test_chat_stream_resumes_after_mid_loop_crash(isolated_kernel, monkeypatch):
    """First tool runs, crash before next LLM call, replay must not re-run the tool."""
    k, db = isolated_kernel
    configure_plan_resume_db(db)
    cid = "ckpt-corr"
    taint_registry.clear(cid)
    try:
        monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
        monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", k)

        seen = {"n": 0}

        def step() -> str:
            seen["n"] += 1
            taint_registry.mark(
                cid, source="external_ingestion", reason="ckpt_step",
            )
            return f"ran-{seen['n']}"

        mcp_hub.register_tool(ToolDef(
            name="ckpt_step", description="x",
            parameters={"type": "object", "properties": {}}, handler=step,
        ))

        stream_calls = {"n": 0}

        async def fake_iter(_response):
            stream_calls["n"] += 1
            if stream_calls["n"] == 1:
                yield {
                    "type": "_stream_assembled",
                    "result": AssembledStream(
                        visible_text="",
                        tool_calls=[{
                            "id": "call_1",
                            "function_name": "ckpt_step",
                            "arguments": "{}",
                        }],
                    ),
                }
            elif stream_calls["n"] == 2:
                raise RuntimeError("simulated process crash")
            else:
                yield {"type": "text_delta", "content": "recovered-from-checkpoint"}
                yield {
                    "type": "_stream_assembled",
                    "result": AssembledStream(
                        visible_text="recovered-from-checkpoint",
                        tool_calls=[],
                    ),
                }

        monkeypatch.setattr(
            "app.core.agents.brain_chat_stream.iter_assembled_stream",
            fake_iter,
        )
        monkeypatch.setattr(
            "app.core.agents.brain_chat_stream.record_llm_call",
            lambda *a, **k: 0,
        )

        llm = SimpleNamespace(
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

        def build_messages(_conv, user_message, *, system_prompt=""):
            return [
                {"role": "system", "content": system_prompt or "s"},
                {"role": "user", "content": user_message},
            ]

        brain = SimpleNamespace(llm=llm, build_messages=build_messages)
        conv = ConversationManager(conversation_id="ckpt-conv", kernel=k)
        k.emit_event(
            "ConversationCreated", "conversation", "ckpt-conv",
            payload={"title": "ckpt"}, actor="user",
        )

        from app.core.agents import brain_chat_stream

        with pytest.raises(RuntimeError, match="simulated process crash"):
            async for _ in brain_chat_stream.chat_stream(
                brain, conv, "do the step",
                system_prompt="s",
                correlation_id=cid,
            ):
                pass

        assert seen["n"] == 1
        ckpt = load_chat_checkpoint(cid, kernel=k)
        assert ckpt is not None
        assert ckpt["messages"]
        assert ckpt.get("tainted") is True
        assert ckpt.get("tool_calls")
        taint_registry.clear(cid)

        events = []
        async for evt in brain_chat_stream.chat_stream(
            brain, conv, "do the step",
            system_prompt="s",
            correlation_id=cid,
        ):
            events.append(evt)

        assert seen["n"] == 1, "resumed loop must not re-execute the tool"
        assert taint_registry.is_tainted(cid), "resume must restore taint from checkpoint"
        texts = "".join(e.get("content", "") for e in events if e.get("type") == "text_delta")
        assert "recovered-from-checkpoint" in texts
        assert load_chat_checkpoint(cid, kernel=k) is None
    finally:
        mcp_hub.unregister_tool("ckpt_step")
        configure_plan_resume_db(None)
        taint_registry.clear(cid)


@pytest.mark.asyncio
async def test_chat_stream_persists_tool_calls_on_confirmation(isolated_kernel, monkeypatch):
    """Approval interrupt must persist assistant tool_calls so resume sees the result."""
    k, _db = isolated_kernel
    configure_plan_resume_db(_db)
    try:
        monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
        monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", k)

        async def pending_invoke(**_kwargs):
            return {"status": "pending", "approval_id": "apr_persist"}

        monkeypatch.setattr(k, "invoke_capability", pending_invoke)

        async def fake_iter(_response):
            yield {
                "type": "_stream_assembled",
                "result": AssembledStream(
                    visible_text="",
                    tool_calls=[{
                        "id": "call_shell_1",
                        "function_name": "shell_exec",
                        "arguments": '{"command": "pwd"}',
                    }],
                ),
            }

        monkeypatch.setattr(
            "app.core.agents.brain_chat_stream.iter_assembled_stream",
            fake_iter,
        )
        monkeypatch.setattr(
            "app.core.agents.brain_chat_stream.record_llm_call",
            lambda *a, **_k: 0,
        )

        llm = SimpleNamespace(
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

        def build_messages(_conv, user_message, *, system_prompt=""):
            return [
                {"role": "system", "content": system_prompt or "s"},
                {"role": "user", "content": user_message},
            ]

        brain = SimpleNamespace(llm=llm, build_messages=build_messages)
        conv = ConversationManager(conversation_id="apr-conv", kernel=k)
        k.emit_event(
            "ConversationCreated", "conversation", "apr-conv",
            payload={"title": "apr"}, actor="user",
        )

        from app.core.agents import brain_chat_stream
        from app.core.agents.brain_history_builder import build_messages as assemble

        events = []
        async for evt in brain_chat_stream.chat_stream(
            brain, conv, "查看当前目录",
            system_prompt="s",
            correlation_id="apr-corr",
        ):
            events.append(evt)

        assert any(e.get("type") == "confirmation_required" for e in events)
        assistants = [m for m in conv.get_history() if m["role"] == "assistant"]
        assert len(assistants) == 1
        assert assistants[0]["tool_calls"][0]["id"] == "call_shell_1"

        conv.save_tool_result(
            '{"status":"error","error":"Command not found: echo"}',
            "call_shell_1",
        )
        assembled = assemble(conv, "", system_prompt="s")
        assert any(
            m.get("role") == "assistant" and m.get("tool_calls")
            for m in assembled
        )
        assert any(
            m.get("role") == "tool" and m.get("tool_call_id") == "call_shell_1"
            for m in assembled
        )
    finally:
        configure_plan_resume_db(None)
