"""Live Brain tool-loop eval — opt-in via RUN_LIVE_LLM=1 + real LLM_API_KEY."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tests.eval.harness import EvalClock, EvalRecord

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_LLM", "").strip() not in {"1", "true", "yes"},
        reason="Set RUN_LIVE_LLM=1 to enable live LLM eval",
    ),
]


@pytest.mark.asyncio
async def test_live_brain_reads_agents_md(isolated_kernel, monkeypatch):
    from app.config import BASE_DIR, settings
    from app.core.agents.brain import Brain
    from app.core.agents.conversation import ConversationManager
    from app.core.runtime.plan_resume import configure_plan_resume_db
    from app.core.runtime.read_ports.events import reconstruct_execution_trace

    api_key = (settings.llm_api_key or os.environ.get("LLM_API_KEY", "")).strip()
    if not api_key or api_key in {"test-key", "demo-seed"}:
        pytest.skip("LLM_API_KEY is missing or is a placeholder test key")

    k, db = isolated_kernel
    configure_plan_resume_db(db)
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
    monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", k)

    target = Path(BASE_DIR) / "AGENTS.md"
    cid = "live-bm-tool"
    conv_id = "live-conv-tool"
    k.emit_event(
        "ConversationCreated", "conversation", conv_id,
        payload={"title": "live eval"}, actor="user",
    )
    conv = ConversationManager(conversation_id=conv_id, kernel=k)
    prompt = (
        f"Use the read_file tool to read the first 25 lines of {target}. "
        "Then reply in one short sentence: what is this file for? "
        "Do not invent a path."
    )
    clock = EvalClock()
    brain = Brain()
    chunks: list[str] = []
    async for evt in brain.chat_stream(
        conv, prompt,
        system_prompt="You are a coding agent. Prefer tools over guessing.",
        correlation_id=cid,
    ):
        if evt.get("type") == "text_delta":
            chunks.append(str(evt.get("content") or ""))
        if evt.get("type") == "error":
            chunks.append(str(evt.get("content") or ""))

    text = "".join(chunks)
    trace = reconstruct_execution_trace(cid)
    tool_names = [t.get("name") for t in trace.get("tools") or []]
    rec = EvalRecord(
        task_id="live_bm01_tool_use",
        input=prompt[:200],
        expected_behavior="read_file invoked; final text mentions AGENTS or coding agent",
        actual_behavior=f"tools={tool_names} text={text[:240]!r}",
        success=(
            "read_file" in tool_names
            and bool(text.strip())
            and ("agent" in text.lower() or "AGENTS" in text or "coding" in text.lower())
        ),
        failure_reason=None if "read_file" in tool_names else "read_file not in trace",
        tool_calls=[str(n) for n in tool_names if n],
        duration_s=clock.elapsed(),
        tokens_cost="NOT MEASURED",
        trace_id=cid,
    )
    assert rec.success, rec.as_dict()
