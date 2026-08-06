"""Inbox filter monitors — user rules evaluated after inbox_poll stores new mail.

Config lives in APP_STORAGE ``app_settings`` category ``monitors`` (not event-sourced),
shared with ``url_monitors`` (see ``url_monitors.py``). Matching new emails emit
``inbox_monitor`` notifications with durable ``dedup_key`` so the same
filter×email pair notifies at most once.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.store.database import db

logger = logging.getLogger(__name__)

SETTINGS_CATEGORY = "monitors"
MAX_ENABLED_FILTERS = 20
NOTIF_TYPE = "inbox_monitor"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _empty_config() -> dict[str, Any]:
    return {"inbox_filters": [], "url_monitors": []}


def _normalize_config(data: dict[str, Any]) -> dict[str, Any]:
    """Ensure known monitor list keys exist and are lists."""
    out = dict(data)
    if not isinstance(out.get("inbox_filters"), list):
        out["inbox_filters"] = []
    if not isinstance(out.get("url_monitors"), list):
        out["url_monitors"] = []
    return out


def _load_monitors_config_strict() -> dict[str, Any]:
    """Load monitors config; raises on DB/JSON errors (never invent empty).

    Write/merge paths must use this so a transient read failure cannot wipe
    sibling lists (inbox_filters ↔ url_monitors).
    """
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM app_settings WHERE category = ?",
            (SETTINGS_CATEGORY,),
        ).fetchone()
    if not row:
        return _empty_config()
    data = json.loads(row["data_json"])
    if not isinstance(data, dict):
        raise ValueError("monitors config is not a JSON object")
    return _normalize_config(data)


def load_monitors_config() -> dict[str, Any]:
    """Load monitors config from app_settings; never raises (read/UI paths)."""
    try:
        return _load_monitors_config_strict()
    except Exception:
        logger.warning("Failed to load monitors config", exc_info=True)
        return _empty_config()


def save_monitors_config(data: dict[str, Any]) -> dict[str, Any]:
    """Persist monitors config. Partial updates merge with existing lists.

    Passing only ``inbox_filters`` preserves ``url_monitors`` (and vice versa).
    Merge reads use the strict loader so DB/JSON errors abort the write instead
    of replacing the sibling list with ``[]``.
    """
    existing = _load_monitors_config_strict()
    payload = {
        "inbox_filters": (
            list(data["inbox_filters"])
            if "inbox_filters" in data
            else list(existing.get("inbox_filters") or [])
        ),
        "url_monitors": (
            list(data["url_monitors"])
            if "url_monitors" in data
            else list(existing.get("url_monitors") or [])
        ),
    }
    payload = _normalize_config(payload)
    now = _now_iso()
    with db.get_db() as conn:
        conn.execute(
            """INSERT INTO app_settings (category, data_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET
                 data_json = excluded.data_json,
                 updated_at = excluded.updated_at""",
            (SETTINGS_CATEGORY, json.dumps(payload, ensure_ascii=False), now),
        )
    return payload


def list_inbox_filters() -> list[dict[str, Any]]:
    cfg = load_monitors_config()
    return [f for f in cfg.get("inbox_filters", []) if isinstance(f, dict)]


def count_enabled_filters(filters: list[dict[str, Any]] | None = None) -> int:
    rows = filters if filters is not None else list_inbox_filters()
    return sum(1 for f in rows if f.get("enabled", True))


def _normalize_match_field(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def validate_filter_fields(
    *,
    name: str,
    sender_contains: str = "",
    subject_contains: str = "",
) -> tuple[str, str, str]:
    """Return cleaned fields or raise ValueError."""
    cleaned_name = (name or "").strip()
    if not cleaned_name:
        raise ValueError("name is required")
    sender = _normalize_match_field(sender_contains)
    subject = _normalize_match_field(subject_contains)
    if not sender and not subject:
        raise ValueError("at least one of sender_contains or subject_contains is required")
    return cleaned_name, sender, subject


def create_inbox_filter(
    *,
    name: str,
    sender_contains: str = "",
    subject_contains: str = "",
    enabled: bool = True,
) -> dict[str, Any]:
    cleaned_name, sender, subject = validate_filter_fields(
        name=name,
        sender_contains=sender_contains,
        subject_contains=subject_contains,
    )
    cfg = load_monitors_config()
    filters = [f for f in cfg.get("inbox_filters", []) if isinstance(f, dict)]
    if enabled and count_enabled_filters(filters) >= MAX_ENABLED_FILTERS:
        raise ValueError(f"at most {MAX_ENABLED_FILTERS} enabled inbox filters")

    row = {
        "id": f"if_{uuid.uuid4().hex[:12]}",
        "enabled": bool(enabled),
        "name": cleaned_name,
        "sender_contains": sender,
        "subject_contains": subject,
        "created_at": _now_iso(),
    }
    filters.append(row)
    save_monitors_config({"inbox_filters": filters})
    return row


def update_inbox_filter(filter_id: str, **updates: Any) -> dict[str, Any]:
    cfg = load_monitors_config()
    filters = [f for f in cfg.get("inbox_filters", []) if isinstance(f, dict)]
    idx = next((i for i, f in enumerate(filters) if f.get("id") == filter_id), None)
    if idx is None:
        raise KeyError(filter_id)

    current = dict(filters[idx])
    name = updates.get("name", current.get("name", ""))
    sender = updates.get("sender_contains", current.get("sender_contains", ""))
    subject = updates.get("subject_contains", current.get("subject_contains", ""))
    cleaned_name, sender, subject = validate_filter_fields(
        name=str(name or ""),
        sender_contains=str(sender or ""),
        subject_contains=str(subject or ""),
    )
    enabled = bool(updates["enabled"]) if "enabled" in updates else bool(current.get("enabled", True))

    if enabled and not current.get("enabled", True):
        # Enabling: check cap excluding this row's previous disabled state
        others = [f for f in filters if f.get("id") != filter_id]
        if count_enabled_filters(others) >= MAX_ENABLED_FILTERS:
            raise ValueError(f"at most {MAX_ENABLED_FILTERS} enabled inbox filters")

    current.update({
        "name": cleaned_name,
        "sender_contains": sender,
        "subject_contains": subject,
        "enabled": enabled,
    })
    filters[idx] = current
    save_monitors_config({"inbox_filters": filters})
    return current


def delete_inbox_filter(filter_id: str) -> None:
    cfg = load_monitors_config()
    filters = [f for f in cfg.get("inbox_filters", []) if isinstance(f, dict)]
    new_filters = [f for f in filters if f.get("id") != filter_id]
    if len(new_filters) == len(filters):
        raise KeyError(filter_id)
    save_monitors_config({"inbox_filters": new_filters})


def filter_matches_email(filt: dict[str, Any], email: dict[str, Any]) -> bool:
    """AND-match; empty match fields are ignored. Case-insensitive contains."""
    sender_needle = _normalize_match_field(filt.get("sender_contains"))
    subject_needle = _normalize_match_field(filt.get("subject_contains"))
    if not sender_needle and not subject_needle:
        return False

    sender_hay = str(email.get("sender") or "").lower()
    subject_hay = str(email.get("subject") or "").lower()
    if sender_needle and sender_needle.lower() not in sender_hay:
        return False
    if subject_needle and subject_needle.lower() not in subject_hay:
        return False
    return True


def dedup_key_for(filter_id: str, email_id: str) -> str:
    return f"inbox_monitor:{filter_id}:{email_id}"


def evaluate_inbox_filters(stored: list[dict[str, Any]]) -> int:
    """Evaluate enabled filters against newly stored emails. Returns new notify count.

    Failures are logged and do not raise — callers in the poll path must not abort.
    """
    if not stored:
        return 0
    try:
        filters = [f for f in list_inbox_filters() if f.get("enabled", True)]
        if not filters:
            return 0

        from app.core.runtime import read_ports

        notified = 0
        for email in stored:
            email_id = str(email.get("id") or "")
            if not email_id:
                continue
            for filt in filters:
                filter_id = str(filt.get("id") or "")
                if not filter_id:
                    continue
                if not filter_matches_email(filt, email):
                    continue
                key = dedup_key_for(filter_id, email_id)
                if read_ports.find_notification(NOTIF_TYPE, dedup_key=key):
                    continue
                title = f"监控 · {filt.get('name', '过滤器')}"
                subject = str(email.get("subject") or "")[:40]
                content = (
                    f"命中规则「{filt.get('name', '')}」：{email.get('sender', '')} — {subject}"
                )
                read_ports.push_notification(
                    NOTIF_TYPE,
                    title,
                    content,
                    related_id=email_id,
                    related_type="inbox_email",
                    dedup_key=key,
                    actor="inbox_monitor",
                )
                notified += 1
        return notified
    except Exception:
        logger.warning("evaluate_inbox_filters failed", exc_info=True)
        return 0
