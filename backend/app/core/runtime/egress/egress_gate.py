"""LLM Egress Audit — outbound call logging with bounded redaction.

Records what leaves the machine for audit. Classification is heuristic.
Sensitive patterns (tokens, passwords, API keys) are redacted in the outbound
payload returned to callers; audit metadata records whether egress is allowed.
"""

from __future__ import annotations

import copy
import logging
import re
import uuid
from typing import Any
from urllib.parse import urlparse

from app.config import settings
from app.core.runtime import kernel_instance

logger = logging.getLogger(__name__)

# Structural field-name patterns for audit classification (not doc-example literals).
_AUDIT_CLASSIFIERS = (
    re.compile(r"identity_narrative_opt_in"),
    re.compile(r"claim_status"),
)

# Heuristic redaction — field names and inline secret patterns.
_SENSITIVE_FIELD = re.compile(
    r"(api[_-]?key|password|secret|token|authorization|bearer)",
    re.IGNORECASE,
)
_SENSITIVE_INLINE = re.compile(
    r"(?i)(sk-[a-zA-Z0-9]{20,}|"
    r"Bearer\s+[A-Za-z0-9._\-+/=]{10,}|"
    r"password\s*[:=]\s*\S+|"
    r"api[_-]?key\s*[:=]\s*\S+)",
)


class EgressDeniedError(PermissionError):
    """Raised when classified personal context is not allowed to leave local."""


def provider_is_local(provider_type: str | None, base_url: str | None) -> bool:
    """Classify provider locality without relying on provider names."""
    if (provider_type or "").strip().lower() == "ollama":
        return True
    try:
        host = (urlparse(base_url or "").hostname or "").lower()
    except ValueError:
        return False
    return host in {"localhost", "127.0.0.1", "::1"}


def _redact_text(text: str) -> tuple[str, bool]:
    """Return redacted text and whether any redaction occurred."""
    if not text:
        return text, False
    redacted, n = _SENSITIVE_INLINE.subn("[REDACTED]", text)
    return redacted, n > 0


def _redact_value(value: Any, *, field_name: str = "") -> tuple[Any, bool]:
    if _SENSITIVE_FIELD.search(field_name):
        return "[REDACTED]", True
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        changed = False
        for key, child in value.items():
            redacted, child_changed = _redact_value(child, field_name=str(key))
            out[key] = redacted
            changed = changed or child_changed
        return out, changed
    if isinstance(value, list):
        out_list: list[Any] = []
        changed = False
        for child in value:
            redacted, child_changed = _redact_value(child)
            out_list.append(redacted)
            changed = changed or child_changed
        return out_list, changed
    return value, False


def redact_llm_messages(messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    """Return a recursively copied message list with secrets redacted."""
    redacted, changed = _redact_value(messages)
    return redacted, changed


def classify_llm_payload(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Classify outbound LLM message content for audit logging."""
    def text_parts(value: Any):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for child in value.values():
                yield from text_parts(child)
        elif isinstance(value, list):
            for child in value:
                yield from text_parts(child)

    combined = "\n".join(text_parts(messages))
    categories: list[str] = []
    if any(p.search(combined) for p in _AUDIT_CLASSIFIERS):
        categories.append("identity_surface")
    if "memory_id:" in combined or "memories" in combined.lower():
        categories.append("memory_context")
    if "event_seq" in combined or "trajectory" in combined.lower():
        categories.append("trajectory_context")
    if not categories:
        categories.append("general")
    return {
        "categories": categories,
        "message_count": len(messages),
        "char_count": len(combined),
        "purpose_hint": None,
    }


def audit_llm_egress(
    messages: list[dict[str, Any]],
    *,
    purpose: str,
    actor: str = "kernel",
    provider_name: str | None = None,
    provider_local: bool | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Audit outbound LLM call, emit EgressAudited, return (redacted_messages, audit_meta).

    Classified personal context is local-only unless explicitly enabled. When
    provider locality is unknown, the call remains audit-only for backwards
    compatibility; all production provider paths pass locality explicitly.
    Emit failures are swallowed so audit never blocks the LLM call path.
    """
    classification = classify_llm_payload(messages)
    classification["purpose_hint"] = purpose
    identity_surface = "identity_surface" in classification["categories"]
    personal_context = bool(
        set(classification["categories"]) & {
            "identity_surface", "memory_context", "trajectory_context",
        }
    )
    redacted_messages, content_redacted = redact_llm_messages(messages)
    denied = bool(
        personal_context
        and provider_local is False
        and not settings.allow_cloud_personal_data_egress
    )

    audit = {
        "purpose": purpose,
        "classification": classification,
        "identity_surface_detected": identity_surface,
        "personal_context_detected": personal_context,
        "provider_name": provider_name,
        "provider_local": provider_local,
        "content_redacted": content_redacted,
        "allowed": not denied,
    }
    if denied:
        audit["denial_reason"] = "classified_personal_context_cloud_egress_disabled"

    try:
        k = kernel_instance.kernel
        k.emit_event(
            "EgressAudited",
            "egress",
            f"egress_{uuid.uuid4().hex[:12]}",
            payload=copy.deepcopy(audit),
            actor=actor,
        )
    except Exception:
        logger.exception("EgressAudited emit failed (purpose=%s); continuing", purpose)
        audit["emit_failed"] = True

    if denied:
        raise EgressDeniedError(
            "Cloud egress denied for classified personal context; "
            "enable ALLOW_CLOUD_PERSONAL_DATA_EGRESS to opt in."
        )
    return redacted_messages, audit


__all__ = [
    "EgressDeniedError",
    "audit_llm_egress",
    "classify_llm_payload",
    "provider_is_local",
    "redact_llm_messages",
]
