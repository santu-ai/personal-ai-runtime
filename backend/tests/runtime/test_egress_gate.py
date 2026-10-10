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


def test_redact_sensitive_text_keeps_line_count_around_a_private_key():
    from app.core.runtime.egress.egress_gate import redact_sensitive_text

    token = "ghp_" + ("b" * 20)
    pem = "\n".join([
        "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
        "Q" * 12,
        "-----END " + "OPENSSH PRIVATE KEY-----",
    ])
    text = "\n".join(["note", "token " + token, pem, "尾注"])
    redacted = redact_sensitive_text(text)
    assert token not in redacted
    assert "Q" * 12 not in redacted
    assert "PRIVATE KEY" not in redacted
    assert redacted.splitlines()[0] == "note"
    assert redacted.splitlines()[-1] == "尾注"
    assert len(redacted.splitlines()) == len(text.splitlines())


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


def test_provider_is_local_uses_target_address_not_type():
    from app.core.runtime.egress.egress_gate import provider_is_local

    assert provider_is_local("ollama", "https://remote.example.invalid") is False
    assert provider_is_local("ollama", "http://192.168.1.8:11434/v1") is False
    assert provider_is_local("ollama", "") is False
    assert provider_is_local("ollama", "http://127.0.0.1:11434/v1") is True
    assert provider_is_local("ollama", "http://127.0.0.2:11434") is True
    assert provider_is_local("ollama", "http://[::1]:11434/v1") is True
    assert provider_is_local("ollama", "localhost:11434") is True
    assert provider_is_local("openai_compatible", "http://localhost:8080/v1") is True
    assert provider_is_local("openai_compatible", "https://api.openai.com/v1") is False


def test_unlabeled_email_prose_stays_general():
    out = classify_llm_payload([
        {"role": "user", "content": "周五的预算还没定，邮件里只写了延期。"},
    ])
    assert out["categories"] == ["general"]
    assert out["data_sources"] == []


def test_explicit_email_and_file_labels_are_restricted(monkeypatch):
    k = MagicMock()
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        k,
    )
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.settings.allow_cloud_personal_data_egress",
        False,
    )
    messages = [{
        "role": "user",
        "content": "周五的预算还没定",
        "data_sources": ["email", "file"],
    }]
    with pytest.raises(EgressDeniedError):
        audit_llm_egress(
            messages,
            purpose="project_brief",
            provider_name="ollama",
            provider_local=False,
        )
    payload = k.emit_event.call_args.kwargs["payload"]
    assert payload["classification"]["data_sources"] == ["email", "file"]
    assert "email_source" in payload["classification"]["categories"]
    assert "file_source" in payload["classification"]["categories"]
    assert payload["allowed"] is False


def test_declared_sources_are_stripped_before_the_provider_payload(monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        MagicMock(),
    )
    original = [{
        "role": "tool",
        "tool_call_id": "tc",
        "content": "file body",
        "data_sources": ["file"],
    }]
    returned, audit = audit_llm_egress(
        original,
        purpose="chat_stream",
        provider_local=True,
    )
    assert "data_sources" not in returned[0]
    assert returned[0]["content"] == "file body"
    assert original[0]["data_sources"] == ["file"]
    assert audit["allowed"] is True
    assert "file_source" in audit["classification"]["categories"]


def test_cloud_opt_in_allows_labeled_email(monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.kernel_instance.kernel",
        MagicMock(),
    )
    monkeypatch.setattr(
        "app.core.runtime.egress.egress_gate.settings.allow_cloud_personal_data_egress",
        True,
    )
    _returned, audit = audit_llm_egress(
        [{"role": "user", "content": "预算", "data_sources": ["email"]}],
        purpose="inbox_summary",
        provider_local=False,
        data_sources=["email"],
    )
    assert audit["allowed"] is True
    assert audit["personal_context_detected"] is True
