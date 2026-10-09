"""LLM Egress Audit — outbound call logging with bounded redaction.

Records what leaves the machine for audit. Classification is heuristic.
Sensitive patterns (tokens, passwords, API keys) are redacted in the outbound
payload returned to callers; audit metadata records whether egress is allowed.
"""

from __future__ import annotations

import copy
import ipaddress
import logging
import re
import uuid
from collections.abc import Iterable
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

# Header emitted by MemoryEngine.format_memory_context when recalled memories are
# actually injected. Classification must key off rendered personal content, not
# vocabulary: `prompts/identity.md` explains *how to use* memories on every turn,
# so matching the bare word denied even "hello" once cloud egress was enforced.
MEMORY_CONTEXT_MARKER = "## 相关记忆"

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


# Tools whose results are personal data. The label is the tool name, not a
# guess about the prose. Ordinary mail or file text without this declaration
# stays ``general`` so the system prompt can mention those words safely.
TOOL_DATA_SOURCES: dict[str, tuple[str, ...]] = {
    "check_inbox": ("email",),
    "read_inbox_email": ("email",),
    "read_file": ("file",),
}
RESTRICTED_DATA_SOURCES = frozenset({"email", "file"})
_SOURCE_CATEGORIES = {
    "email": "email_source",
    "file": "file_source",
}
_PERSONAL_CATEGORIES = frozenset({
    "identity_surface",
    "memory_context",
    "trajectory_context",
    "email_source",
    "file_source",
})


def _target_host(base_url: str | None) -> str:
    """Hostname of the URL the provider will actually call."""
    raw = (base_url or "").strip()
    if not raw:
        return ""
    candidate = raw if "://" in raw else f"//{raw}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return ""
    return (parsed.hostname or "").strip().lower().rstrip(".")


def provider_is_local(provider_type: str | None, base_url: str | None) -> bool:
    """True only when the outbound target is a loopback address.

    ``provider_type`` is not evidence. An ``ollama`` provider whose base URL
    is a public or LAN host is remote: the request leaves this machine.
    Loopback is ``localhost``, ``127.0.0.0/8``, and ``::1``.
    """
    del provider_type
    host = _target_host(base_url)
    if host == "localhost":
        return True
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def data_sources_for_tool(tool_name: str | None) -> tuple[str, ...]:
    """Explicit source labels for a tool result, or empty when unrestricted."""
    return TOOL_DATA_SOURCES.get((tool_name or "").strip(), ())


def with_tool_data_sources(message: dict[str, Any], tool_name: str | None) -> dict[str, Any]:
    """Attach source labels without changing the user-visible tool content."""
    sources = data_sources_for_tool(tool_name)
    if not sources:
        return message
    labeled = dict(message)
    labeled["data_sources"] = list(sources)
    return labeled


def _normalize_sources(raw: Any) -> list[str]:
    found: list[str] = []

    def add(item: Any) -> None:
        name = str(item or "").strip().lower()
        if name in RESTRICTED_DATA_SOURCES and name not in found:
            found.append(name)

    if raw is None:
        return found
    if isinstance(raw, str):
        add(raw)
        return found
    if isinstance(raw, Iterable) and not isinstance(raw, (bytes, bytearray)):
        for item in raw:
            add(item)
    return found


def _sources_on_messages(messages: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        for name in _normalize_sources(msg.get("data_sources")):
            if name not in found:
                found.append(name)
    return found


def _strip_data_source_keys(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop the audit-only label before the provider SDK sees the payload."""
    if not any(isinstance(msg, dict) and "data_sources" in msg for msg in messages):
        return messages
    stripped: list[dict[str, Any]] = []
    for msg in messages:
        if isinstance(msg, dict) and "data_sources" in msg:
            stripped.append({key: value for key, value in msg.items() if key != "data_sources"})
        else:
            stripped.append(msg)
    return stripped


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


def classify_llm_payload(
    messages: list[dict[str, Any]],
    *,
    data_sources: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Classify outbound LLM message content for audit logging.

    Email and file content count only when a caller declares ``data_sources``
    (or a tool message carries the same label). Unlabeled prose stays general.
    """
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
    if "memory_id:" in combined or MEMORY_CONTEXT_MARKER in combined:
        categories.append("memory_context")
    if "event_seq" in combined or "trajectory" in combined.lower():
        categories.append("trajectory_context")
    declared = _normalize_sources(data_sources)
    for name in _sources_on_messages(messages):
        if name not in declared:
            declared.append(name)
    for name in declared:
        categories.append(_SOURCE_CATEGORIES[name])
    if not categories:
        categories.append("general")
    return {
        "categories": categories,
        "data_sources": declared,
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
    data_sources: Iterable[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Audit outbound LLM call, emit EgressAudited, return (redacted_messages, audit_meta).

    Classified personal context is local-only unless explicitly enabled. When
    provider locality is unknown, the call remains audit-only for backwards
    compatibility; all production provider paths pass locality explicitly.
    Emit failures are swallowed so audit never blocks the LLM call path.
    """
    classification = classify_llm_payload(messages, data_sources=data_sources)
    classification["purpose_hint"] = purpose
    identity_surface = "identity_surface" in classification["categories"]
    personal_context = bool(set(classification["categories"]) & _PERSONAL_CATEGORIES)
    redacted_messages, content_redacted = redact_llm_messages(messages)
    redacted_messages = _strip_data_source_keys(redacted_messages)
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
    "MEMORY_CONTEXT_MARKER",
    "EgressDeniedError",
    "audit_llm_egress",
    "classify_llm_payload",
    "data_sources_for_tool",
    "provider_is_local",
    "redact_llm_messages",
    "with_tool_data_sources",
]
