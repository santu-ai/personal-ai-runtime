"""Live Context A/B — does a mail fragment change the Brain's answer?

Opt-in: RUN_LIVE_LLM=1 + real LLM_API_KEY.

Unlike live memory A/B (which stuffs ``retrieve_context_string`` into
``system_prompt``), this compiles through ``PromptCompiler`` so fragment
selection and assembly are on the path. Tools are disabled so the model
cannot bypass fragments via ``check_inbox``.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

import pytest

from tests.eval.harness import EvalClock, EvalRecord

pytestmark = [
    pytest.mark.live_llm,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_LLM", "").strip() not in {"1", "true", "yes"},
        reason="Set RUN_LIVE_LLM=1 to enable live LLM eval",
    ),
]

_NONCE = "QX-7N-MIRROR"
_MAIL_QUESTION = (
    "What passphrase is in my latest email? "
    "Answer with the token if you know it, otherwise say you do not know."
)
_OFFTOPIC = "What is 2+2? Reply with the number only."
_GUARD = (
    "Answer from the provided context only. Do not call tools. "
    "If the passphrase is not in context, say you do not know."
)


def _seed_passphrase_email(kernel) -> None:
    from app.core.runtime.kernel import constants

    kernel.emit_event(
        constants.EVENT_INBOX_EMAIL_RECORDED,
        constants.AGGREGATE_INBOX_EMAIL,
        "live-ctx-mail",
        payload={
            "sender": "ops@example.test",
            "subject": f"Runtime passphrase {_NONCE}",
            "preview": f"Passphrase: {_NONCE}. Ignore other mail.",
            "received_at": datetime.now(UTC).isoformat(),
            "category": "important",
            "importance": 0.99,
            "reason": "live context A/B",
        },
        actor="test",
    )


async def _compile(user_message: str, *, conversation_id: str, execution_id: str) -> str:
    from app.chat.prompt_compiler import CompileContext, PromptCompiler

    compiler = PromptCompiler()
    return await compiler.compile(
        CompileContext(
            conversation_id=conversation_id,
            execution_id=execution_id,
            user_message=user_message,
            stage="chat",
        ),
        budget=8000,
    )


def _last_plan_ids() -> list[str]:
    from app.core.runtime.governance.context_pipeline import context_pipeline

    plan = context_pipeline.last_compile_plan()
    return list(plan.selected_fragment_ids) if plan else []


async def _ask(brain, conv, prompt: str, *, system_prompt: str, correlation_id: str) -> str:
    chunks: list[str] = []
    async for evt in brain.chat_stream(
        conv,
        prompt,
        system_prompt=system_prompt,
        correlation_id=correlation_id,
    ):
        if evt.get("type") == "text_delta":
            chunks.append(str(evt.get("content") or ""))
        if evt.get("type") == "error":
            chunks.append(str(evt.get("content") or ""))
    return "".join(chunks)


@pytest.mark.asyncio
async def test_live_context_mail_fragment_changes_brain_answer(isolated_kernel, monkeypatch):
    from app.config import settings
    from app.core.agents.brain import Brain
    from app.core.agents.conversation import ConversationManager
    from app.core.runtime.plan_resume import configure_plan_resume_db

    api_key = (settings.llm_api_key or os.environ.get("LLM_API_KEY", "")).strip()
    if not api_key or api_key in {"test-key", "demo-seed"}:
        pytest.skip("LLM_API_KEY is missing or is a placeholder test key")

    k, db = isolated_kernel
    configure_plan_resume_db(db)
    monkeypatch.setattr(k, "list_capability_definitions", lambda: [])
    monkeypatch.setattr("app.core.runtime.kernel_instance.kernel", k)
    monkeypatch.setattr("app.core.agents.brain_chat_stream.kernel", k)
    monkeypatch.setattr("app.core.agents.brain_llm_ops.kernel", k)

    k.emit_event(
        "ConversationCreated",
        "conversation",
        "live-ctx-ctrl",
        payload={"title": "live context control"},
        actor="user",
    )
    k.emit_event(
        "ConversationCreated",
        "conversation",
        "live-ctx-treat",
        payload={"title": "live context treatment"},
        actor="user",
    )

    clock = EvalClock()
    brain = Brain()

    control_prompt = await _compile(
        _MAIL_QUESTION,
        conversation_id="live-ctx-ctrl",
        execution_id="live-ctx-ctrl-ex",
    )
    control_ids = _last_plan_ids()
    assert any(i.startswith("mail.") for i in control_ids), (
        f"mail question must select mail fragments, got {control_ids}"
    )
    assert _NONCE not in control_prompt, "empty inbox must not leak the nonce"

    control = await _ask(
        brain,
        ConversationManager(conversation_id="live-ctx-ctrl", kernel=k),
        _MAIL_QUESTION,
        system_prompt=f"{_GUARD}\n\n{control_prompt}",
        correlation_id="live-ctx-ctrl",
    )

    _seed_passphrase_email(k)

    offtopic_prompt = await _compile(
        _OFFTOPIC,
        conversation_id="live-ctx-treat",
        execution_id="live-ctx-offtopic-ex",
    )
    offtopic_ids = _last_plan_ids()
    assert not any(i.startswith("mail.") for i in offtopic_ids), (
        f"math question must not select mail fragments after seeding, got {offtopic_ids}"
    )
    assert _NONCE not in offtopic_prompt, "unselected mail must not leak nonce into math prompt"

    treatment_prompt = await _compile(
        _MAIL_QUESTION,
        conversation_id="live-ctx-treat",
        execution_id="live-ctx-treat-ex",
    )
    treatment_ids = _last_plan_ids()
    assert "mail.recent_emails" in treatment_ids, (
        f"treatment must select mail.recent_emails, got {treatment_ids}"
    )
    assert _NONCE in treatment_prompt, "assembled mail fragment must carry the nonce before the LLM call"

    treatment = await _ask(
        brain,
        ConversationManager(conversation_id="live-ctx-treat", kernel=k),
        _MAIL_QUESTION,
        system_prompt=f"{_GUARD}\n\n{treatment_prompt}",
        correlation_id="live-ctx-treat",
    )

    rec = EvalRecord(
        task_id="live_bm07_context_ab",
        input=_MAIL_QUESTION,
        expected_behavior="control omits nonce; treatment includes nonce",
        actual_behavior=f"ctrl={control[:180]!r} treat={treatment[:180]!r}",
        success=(_NONCE not in control) and (_NONCE in treatment),
        failure_reason=None if _NONCE in treatment else "treatment did not use compiled mail fragment",
        duration_s=clock.elapsed(),
        tokens_cost="NOT MEASURED",
        notes="PromptCompiler + mail.recent_emails. Tools disabled. Off-topic compile asserted separately.",
        trace_id="live-ctx-treat",
    )
    assert rec.success, rec.as_dict()
