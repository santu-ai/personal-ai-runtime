"""URL diff monitors — periodic page fetch; notify only when content hash changes.

Config + last-seen snapshot live in APP_STORAGE ``app_settings`` category
``monitors`` (key ``url_monitors``), sharing the store with inbox filters.
Zero new governed tables / event types. Fetch uses SSRF-safe harness client.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from app.product.inbox_monitors import load_monitors_config, save_monitors_config

logger = logging.getLogger(__name__)

MAX_ENABLED = 10
MIN_INTERVAL_MINUTES = 30
MAX_INTERVAL_MINUTES = 1440
DEFAULT_INTERVAL_MINUTES = 60
# Cron path: bound work per tick so a backlog cannot stampede 10×20s fetches.
MAX_CHECKS_PER_CRON = 3
NOTIF_TYPE = "url_monitor"
_CONTENT_PREVIEW_LEN = 120


def _now() -> datetime:
    return datetime.now(UTC)


def _now_iso() -> str:
    return _now().isoformat()


def list_url_monitors() -> list[dict[str, Any]]:
    cfg = load_monitors_config()
    return [m for m in cfg.get("url_monitors", []) if isinstance(m, dict)]


def count_enabled(monitors: list[dict[str, Any]] | None = None) -> int:
    rows = monitors if monitors is not None else list_url_monitors()
    return sum(1 for m in rows if m.get("enabled", True))


def _clamp_interval(raw: object) -> int:
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        value = DEFAULT_INTERVAL_MINUTES
    return max(MIN_INTERVAL_MINUTES, min(MAX_INTERVAL_MINUTES, value))


def validate_url_fields(*, name: str, url: str) -> tuple[str, str]:
    cleaned_name = (name or "").strip()
    if not cleaned_name:
        raise ValueError("name is required")
    cleaned_url = (url or "").strip()
    if not cleaned_url:
        raise ValueError("url is required")
    parsed = urlparse(cleaned_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("url must be http(s) with a host")
    return cleaned_name, cleaned_url


def create_url_monitor(
    *,
    name: str,
    url: str,
    enabled: bool = True,
    check_interval_minutes: int = DEFAULT_INTERVAL_MINUTES,
) -> dict[str, Any]:
    cleaned_name, cleaned_url = validate_url_fields(name=name, url=url)
    interval = _clamp_interval(check_interval_minutes)
    monitors = list_url_monitors()
    if enabled and count_enabled(monitors) >= MAX_ENABLED:
        raise ValueError(f"at most {MAX_ENABLED} enabled URL monitors")

    row = {
        "id": f"um_{uuid.uuid4().hex[:12]}",
        "enabled": bool(enabled),
        "name": cleaned_name,
        "url": cleaned_url,
        "check_interval_minutes": interval,
        "created_at": _now_iso(),
        "last_hash": None,
        "last_title": None,
        "last_checked_at": None,
        "last_error": None,
    }
    monitors.append(row)
    save_monitors_config({"url_monitors": monitors})
    return row


def update_url_monitor(monitor_id: str, **updates: Any) -> dict[str, Any]:
    monitors = list_url_monitors()
    idx = next((i for i, m in enumerate(monitors) if m.get("id") == monitor_id), None)
    if idx is None:
        raise KeyError(monitor_id)

    current = dict(monitors[idx])
    name = updates.get("name", current.get("name", ""))
    url = updates.get("url", current.get("url", ""))
    cleaned_name, cleaned_url = validate_url_fields(name=str(name or ""), url=str(url or ""))
    enabled = bool(updates["enabled"]) if "enabled" in updates else bool(current.get("enabled", True))
    if "check_interval_minutes" in updates:
        interval = _clamp_interval(updates["check_interval_minutes"])
    else:
        interval = _clamp_interval(current.get("check_interval_minutes"))

    if enabled and not current.get("enabled", True):
        others = [m for m in monitors if m.get("id") != monitor_id]
        if count_enabled(others) >= MAX_ENABLED:
            raise ValueError(f"at most {MAX_ENABLED} enabled URL monitors")

    # URL change resets baseline so the next check does not false-notify.
    if cleaned_url != current.get("url"):
        current["last_hash"] = None
        current["last_title"] = None
        current["last_error"] = None

    current.update({
        "name": cleaned_name,
        "url": cleaned_url,
        "enabled": enabled,
        "check_interval_minutes": interval,
    })
    monitors[idx] = current
    save_monitors_config({"url_monitors": monitors})
    return current


def delete_url_monitor(monitor_id: str) -> None:
    monitors = list_url_monitors()
    new_rows = [m for m in monitors if m.get("id") != monitor_id]
    if len(new_rows) == len(monitors):
        raise KeyError(monitor_id)
    save_monitors_config({"url_monitors": new_rows})


def content_hash(text: str) -> str:
    """Stable hash of normalized page text (whitespace collapsed)."""
    normalized = re.sub(r"\s+", " ", (text or "").strip()).lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def dedup_key_for(monitor_id: str, digest: str) -> str:
    return f"url_monitor:{monitor_id}:{digest[:32]}"


def _parse_iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def due_for_check(mon: dict[str, Any], *, now: datetime | None = None) -> bool:
    """True when enabled monitor has never been checked or interval elapsed."""
    if not mon.get("enabled", True):
        return False
    last = _parse_iso(mon.get("last_checked_at"))
    if last is None:
        return True
    interval = _clamp_interval(mon.get("check_interval_minutes"))
    ref = now or _now()
    return ref >= last + timedelta(minutes=interval)


def _preview(text: str, limit: int = _CONTENT_PREVIEW_LEN) -> str:
    collapsed = re.sub(r"\s+", " ", (text or "").strip())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1] + "…"


def _persist_monitor_row(monitor_id: str, patch: dict[str, Any]) -> None:
    monitors = list_url_monitors()
    for i, m in enumerate(monitors):
        if m.get("id") == monitor_id:
            updated = dict(m)
            updated.update(patch)
            monitors[i] = updated
            save_monitors_config({"url_monitors": monitors})
            return


async def _fetch_page(url: str) -> dict[str, Any]:
    """Fetch via SSRF-safe FetchServer; returns parsed JSON dict."""
    from app.core.harness.builtin_tools.fetch import fetch_server

    raw = await fetch_server.fetch_url(url, extract_text=True)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "invalid fetch response"}
    return data if isinstance(data, dict) else {"error": "invalid fetch response"}


async def evaluate_url_monitors(
    *,
    force: bool = False,
    max_checks: int | None = None,
) -> int:
    """Check due URL monitors. Returns count of new change notifications.

    First successful fetch establishes a baseline (no notify). Subsequent
    hash changes notify once per digest via durable ``dedup_key``.
    Failures are logged per-monitor and do not abort the batch.

    When ``force`` is False (cron), at most ``MAX_CHECKS_PER_CRON`` due
    monitors run per call; the rest wait for the next tick. Pass
    ``max_checks`` to override (``None`` with ``force=True`` means no cap).
    """
    try:
        from app.core.runtime import read_ports

        monitors = [m for m in list_url_monitors() if m.get("enabled", True)]
        if not monitors:
            return 0

        if max_checks is None:
            limit: int | None = None if force else MAX_CHECKS_PER_CRON
        else:
            limit = max(0, int(max_checks))

        notified = 0
        checked = 0
        now = _now()
        for mon in monitors:
            monitor_id = str(mon.get("id") or "")
            url = str(mon.get("url") or "")
            if not monitor_id or not url:
                continue
            if not force and not due_for_check(mon, now=now):
                continue
            if limit is not None and checked >= limit:
                break
            checked += 1

            try:
                page = await _fetch_page(url)
            except Exception as exc:
                logger.warning("url_monitor fetch failed id=%s: %s", monitor_id, exc)
                _persist_monitor_row(monitor_id, {
                    "last_checked_at": _now_iso(),
                    "last_error": f"{type(exc).__name__}: {exc}"[:200],
                })
                continue

            if page.get("error"):
                err = str(page["error"])[:200]
                logger.info("url_monitor fetch error id=%s: %s", monitor_id, err)
                _persist_monitor_row(monitor_id, {
                    "last_checked_at": _now_iso(),
                    "last_error": err,
                })
                continue

            content = str(page.get("content") or "")
            title = str(page.get("title") or "")[:200]
            digest = content_hash(content)
            previous = mon.get("last_hash")

            patch: dict[str, Any] = {
                "last_checked_at": _now_iso(),
                "last_hash": digest,
                "last_title": title or mon.get("last_title"),
                "last_error": None,
            }

            if previous is None:
                # Baseline — do not notify on first sight.
                _persist_monitor_row(monitor_id, patch)
                continue

            if previous == digest:
                _persist_monitor_row(monitor_id, patch)
                continue

            key = dedup_key_for(monitor_id, digest)
            if read_ports.find_notification(NOTIF_TYPE, dedup_key=key):
                _persist_monitor_row(monitor_id, patch)
                continue

            display_title = title or mon.get("name") or url
            preview = _preview(content)
            read_ports.push_notification(
                NOTIF_TYPE,
                f"监控 · {mon.get('name', '网页')}",
                f"「{display_title}」有更新：{preview}",
                related_id=monitor_id,
                related_type="url_monitor",
                dedup_key=key,
                actor="url_monitor",
            )
            notified += 1
            _persist_monitor_row(monitor_id, patch)

        return notified
    except Exception:
        logger.warning("evaluate_url_monitors failed", exc_info=True)
        return 0
