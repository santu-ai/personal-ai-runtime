"""Egress audit gate — emit failure must not block LLM path."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.core.runtime.egress.egress_gate import (
    MEMORY_CONTEXT_MARKER,
    EgressDeniedError,
    audit_llm_egress,
    classify_llm_payload,
)


def test_classify_general():
    out = classify_llm_payload([{"role": "user", "content": "hello"}])
    assert out["categories"] == ["general"]


def test_identity_artifact_alone_is_not_personal_context():
    """The system prompt explains how to use memories on every single turn.

    Classifying on that vocabulary denied every cloud chat — including a bare
    "hello" — the moment egress enforcement landed. Only rendered personal
    content may count.
    """
    from app.chat.prompt_artifact import IDENTITY_ARTIFACT

    assert "Memories" in IDENTITY_ARTIFACT, "guard assumes identity.md mentions memories"
    out = classify_llm_payload(
        [
            {"role": "system", "content": IDENTITY_ARTIFACT},
            {"role": "user", "content": "你好"},
        ],
    )
    assert out["categories"] == ["general"]


def test_rendered_memory_block_is_personal_context():
    """The marker the recall renderer actually emits must still be caught."""
    from app.core.agents.memory_engine import MemoryEngine

    rendered = MemoryEngine().format_memory_context(
        [{"id": "m1", "content": "用户住在杭州", "confidence": 0.9}],
    )
    assert MEMORY_CONTEXT_MARKER in rendered, "renderer must keep emitting the marker"
    out = classify_llm_payload([{"role": "system", "content": rendered}])
    assert "memory_context" in out["categories"]


def test_audit_llm_egress_swallows_emit_failure(monkeypatch):
    broken = MagicMock()
    broken.emit_event.side_effect = RuntimeError("kernel down")
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        broken,
    )
    messages = [{"role": "user", "content": "hi"}]
    out, audit = audit_llm_egress(messages, purpose="chat")
    assert out == messages
    assert audit["emit_failed"] is True
    assert audit["purpose"] == "chat"


def test_audit_llm_egress_redacts_secrets(monkeypatch):
    k = MagicMock()
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        k,
    )
    messages = [{"role": "user", "content": "password=placeholder-not-a-secret"}]
    out, audit = audit_llm_egress(messages, purpose="chat")
    assert "[REDACTED]" in out[0]["content"]
    assert audit["content_redacted"] is True
    assert audit["allowed"] is True


def test_audit_llm_egress_denies_personal_context_to_cloud(monkeypatch):
    k = MagicMock()
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        k,
    )
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.settings.allow_cloud_personal_data_egress",
        False,
    )

    with pytest.raises(EgressDeniedError):
        audit_llm_egress(
            [{"role": "user", "content": "memory_id: private-1"}],
            purpose="chat",
            provider_name="deepseek",
            provider_local=False,
        )

    payload = k.emit_event.call_args.kwargs["payload"]
    assert payload["allowed"] is False
    assert payload["personal_context_detected"] is True
