"""Live Memory A/B — does injected recall change the Brain's answer?

Opt-in: RUN_LIVE_LLM=1 + real LLM_API_KEY. Isolated Kernel has no Chroma;
this test attaches an in-process index (same as bm06) and measures *agent
behavior*, not embedding quality.
"""

from __future__ import annotations

import os

import pytest

from tests.eval.harness import EvalClock, EvalRecord

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_LLM", "").strip() not in {"1", "true", "yes"},
        reason="Set RUN_LIVE_LLM=1 to enable live LLM eval",
    ),
]

_NONCE = "ZX9-QUOKKA-771"
_QUESTION = "What is my personal runtime token? Answer with the token if you know it, otherwise say you do not know."


class _Index:
    def __init__(self) -> None:
        self.docs: dict[str, str] = {}

    def index_memory(self, content, metadata=None, memory_id=None):
        mid = memory_id or "m"
        self.docs[mid] = content
        return mid

    def search_memories(self, query, n_results=5):
        return [
            {"id": mid, "content": text, "metadata": {}, "distance": 0.1}
            for mid, text in list(self.docs.items())[:n_results]
        ]

    def delete_memory(self, memory_id):
        self.docs.pop(memory_id, None)


async def _ask(brain, conv, prompt: str, *, system_prompt: str, correlation_id: str) -> str:
    chunks: list[str] = []
    async for evt in brain.chat_stream(
        conv, prompt,
        system_prompt=system_prompt,
        correlation_id=correlation_id,
    ):
        if evt.get("type") == "text_delta":
            chunks.append(str(evt.get("content") or ""))
        if evt.get("type") == "error":
            chunks.append(str(evt.get("content") or ""))
    return "".join(chunks)


@pytest.mark.asyncio
async def test_live_memory_changes_brain_answer(isolated_kernel, monkeypatch):
    from app.config import settings
    from app.core.agents.brain import Brain
    from app.core.agents.conversation import ConversationManager
    from app.core.agents.memory_engine import MemoryEngine
    from app.core.runtime.plan_resume import configure_plan_resume_db

    api_key = (settings.llm_api_key or os.environ.get("LLM_API_KEY", "")).strip()
    if not api_key or api_key in {"test-key", "demo-seed"}:
        pytest.skip("LLM_API_KEY is missing or is a placeholder test key")

    k, db = isolated_kernel
    configure_plan_resume_db(db)
    k._memory_index = _Index()
    monkeypatch.setattr(k, "list_capability_definitions", lambda: [])
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
    monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", k)
    monkeypatch.setattr("app.core.agents.brain_llm_ops.kernel", k)

    k.emit_event(
        "ConversationCreated", "conversation", "live-mem-ctrl",
        payload={"title": "live memory control"}, actor="user",
    )
    k.emit_event(
        "ConversationCreated", "conversation", "live-mem-treat",
        payload={"title": "live memory treatment"}, actor="user",
    )

    brain = Brain()
    clock = EvalClock()
    base_system = (
        "Answer from the provided context only. Do not call tools. "
        "If the token is not in context, say you do not know."
    )
    control = await _ask(
        brain, ConversationManager(conversation_id="live-mem-ctrl", kernel=k),
        _QUESTION, system_prompt=base_system, correlation_id="live-mem-ctrl",
    )

    engine = MemoryEngine()
    engine.store_memory(
        f"The user's personal runtime token is {_NONCE}.",
        category="fact",
        actor="user",
        confidence=0.95,
    )
    memory_block = engine.retrieve_context_string(
        "personal runtime token", max_memories=3,
    )
    assert _NONCE in memory_block, "recall must surface the stored nonce before the LLM call"

    treatment = await _ask(
        brain, ConversationManager(conversation_id="live-mem-treat", kernel=k),
        _QUESTION,
        system_prompt=f"{base_system}\n\n{memory_block}",
        correlation_id="live-mem-treat",
    )

    rec = EvalRecord(
        task_id="live_bm06_memory_ab",
        input=_QUESTION,
        expected_behavior="control omits nonce; treatment includes nonce",
        actual_behavior=f"ctrl={control[:180]!r} treat={treatment[:180]!r}",
        success=(_NONCE not in control) and (_NONCE in treatment),
        failure_reason=None if _NONCE in treatment else "treatment did not use injected memory",
        duration_s=clock.elapsed(),
        tokens_cost="NOT MEASURED",
        notes="In-process index, not Chroma. Tools disabled for this A/B.",
        trace_id="live-mem-treat",
    )
    assert rec.success, rec.as_dict()
