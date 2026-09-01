"""Telegram transport gateway using existing Capability and Chat events."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import settings
from app.core.runtime import read_ports
from app.core.runtime.kernel_instance import kernel
from app.store.database import db

logger = logging.getLogger(__name__)

SETTINGS_CATEGORY = "telegram_gateway"


def _defaults() -> dict[str, Any]:
    return {
        "enabled": False,
        "auto_reply": False,
        "last_update_id": 0,
        "conversation_id": "",
        "last_error": "",
        "last_polled_at": "",
        "last_sent_at": "",
        "consecutive_failures": 0,
        "next_poll_at": "",
    }


def _load_config_from_conn(conn) -> dict[str, Any]:
    row = conn.execute(
        "SELECT data_json FROM app_settings WHERE category = ?",
        (SETTINGS_CATEGORY,),
    ).fetchone()
    raw = json.loads(row["data_json"]) if row else {}
    if raw and not isinstance(raw, dict):
        raise ValueError("telegram_gateway settings are not an object")
    return {**_defaults(), **(raw if isinstance(raw, dict) else {})}


def _load_config_strict() -> dict[str, Any]:
    with db.get_db() as conn:
        return _load_config_from_conn(conn)


def load_config() -> dict[str, Any]:
    try:
        return _load_config_strict()
    except Exception:
        logger.warning("Failed to load Telegram gateway config", exc_info=True)
        return _defaults()


def save_config(changes: dict[str, Any], *, audit: bool = True) -> dict[str, Any]:
    _load_config_strict()
    now = datetime.now(UTC).isoformat()
    with db.get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = _load_config_from_conn(conn)
        current.update({
            key: value
            for key, value in changes.items()
            if key in _defaults()
        })
        current["enabled"] = bool(current["enabled"])
        current["auto_reply"] = bool(current["auto_reply"])
        current["last_update_id"] = max(int(current["last_update_id"] or 0), 0)
        current["last_error"] = str(current["last_error"] or "")[:500]
        conn.execute(
            """INSERT INTO app_settings (category, data_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET
                 data_json = excluded.data_json,
                 updated_at = excluded.updated_at""",
            (SETTINGS_CATEGORY, json.dumps(current, ensure_ascii=False), now),
        )
    if audit:
        kernel.emit_event(
            "AppConfigChanged",
            "app_config",
            SETTINGS_CATEGORY,
            payload={
                "category": SETTINGS_CATEGORY,
                "enabled": current["enabled"],
                "auto_reply": current["auto_reply"],
            },
            actor="user",
        )
    return current


def public_status() -> dict[str, Any]:
    config = load_config()
    token_configured = bool(settings.telegram_bot_token.strip())
    chat_configured = bool(settings.telegram_chat_id.strip())
    category_enabled = "telegram" in {
        item.strip()
        for item in settings.builtin_tool_categories.split(",")
        if item.strip()
    } or settings.builtin_tool_categories.strip() == "*"
    return {
        **config,
        "token_configured": token_configured,
        "chat_configured": chat_configured,
        "capability_enabled": category_enabled,
        "connected": bool(
            config["enabled"]
            and token_configured
            and chat_configured
            and category_enabled
            and not config["last_error"]
        ),
    }


async def poll_once() -> dict[str, Any]:
    """Long-poll once and enqueue each allowlisted Telegram update exactly once."""
    config = load_config()
    if not config["enabled"]:
        return {"status": "disabled", "processed": 0}
    now_dt = datetime.now(UTC)
    if config.get("next_poll_at"):
        try:
            if datetime.fromisoformat(str(config["next_poll_at"])) > now_dt:
                return {"status": "backoff", "processed": 0}
        except ValueError:
            pass
    offset = int(config["last_update_id"] or 0) + 1
    from app.core.runtime.kernel_instance import get_current_execution_id

    execution_id = get_current_execution_id()
    result = await kernel.invoke_capability(
        "telegram_updates",
        {"offset": offset, "limit": 25, "timeout": 10},
        actor="scheduler" if execution_id else "user",
        correlation_id=f"telegram:poll:{offset}",
        execution_id=execution_id,
    )
    now = now_dt.isoformat()
    if result.get("status") != "success":
        error = str(result.get("error") or "telegram_updates failed")
        failures = int(config.get("consecutive_failures") or 0) + 1
        delay_seconds = min(60 * (2 ** (failures - 1)), 900)
        save_config({
            "last_error": error,
            "last_polled_at": now,
            "consecutive_failures": failures,
            "next_poll_at": (now_dt + timedelta(seconds=delay_seconds)).isoformat(),
        }, audit=False)
        return {"status": "error", "processed": 0, "error": error}
    try:
        payload = json.loads(result.get("result") or "{}")
    except (TypeError, json.JSONDecodeError):
        payload = {}
    processed = 0
    stalled = False
    last_update_id = int(config["last_update_id"] or 0)
    conversation_id = str(config.get("conversation_id") or "")
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
    if read_ports.query_conversation(conversation_id) is None:
        kernel.emit_event(
            "ConversationCreated",
            "conversation",
            conversation_id,
            payload={"title": "Telegram", "transport": "telegram"},
            actor="user",
        )
    configured_chat_id = settings.telegram_chat_id.strip()
    for update in payload.get("updates") or []:
        update_id = int(update.get("update_id") or 0)
        chat_id = str(update.get("chat_id") or "")
        text = str(update.get("text") or "").strip()
        if not update_id or chat_id != configured_chat_id or not text:
            continue
        correlation_id = f"telegram:{update_id}"
        if kernel.read_events(
            type="ChatRequested",
            correlation_id=correlation_id,
            limit=1,
        ):
            last_update_id = max(last_update_id, update_id)
            continue
        if read_ports.conversation_chat_in_flight(conversation_id):
            stalled = True
            break
        read_ports.mark_external_taint(correlation_id, reason="telegram_updates")
        kernel.emit_event(
            "ChatRequested",
            "chat",
            f"chat_{conversation_id}",
            payload={
                "conversation_id": conversation_id,
                "user_message": text,
                "transport": "telegram",
                "telegram_update_id": update_id,
                "telegram_chat_id": chat_id,
            },
            actor=f"user:telegram:{chat_id}",
            correlation_id=correlation_id,
        )
        last_update_id = max(last_update_id, update_id)
        processed += 1
    next_offset = payload.get("next_offset")
    if not stalled and next_offset is not None:
        last_update_id = max(last_update_id, int(next_offset) - 1)
    save_config({
        "conversation_id": conversation_id,
        "last_update_id": last_update_id,
        "last_error": "",
        "last_polled_at": now,
        "consecutive_failures": 0,
        "next_poll_at": "",
    }, audit=False)
    return {"status": "ok", "processed": processed, "last_update_id": last_update_id}


async def send_reply(text: str, *, correlation_id: str) -> dict[str, Any]:
    """Send or defer one exact Telegram reply under scoped consent."""
    config = load_config()
    if not config["enabled"] or not text.strip():
        return {"status": "disabled"}
    chat_id = settings.telegram_chat_id.strip()
    actor = f"user:telegram:{chat_id}"
    args = {"text": text[:4000], "chat_id": chat_id, "parse_mode": ""}
    invoke_kwargs: dict[str, Any] = {}
    if config["auto_reply"]:
        approval = kernel.request_approval(
            "telegram_send",
            risk="high",
            ctx={"args": args, "scope": {"chat_id": chat_id, "one_shot": True}},
            actor=actor,
            correlation_id=correlation_id,
        )
        approval_id = str(approval.get("approval_id") or "")
        invoke_kwargs = {"pre_approved": True, "approval_id": approval_id}
    result = await kernel.invoke_capability(
        "telegram_send",
        args,
        actor=actor,
        correlation_id=correlation_id,
        **invoke_kwargs,
    )
    changes = {"last_sent_at": datetime.now(UTC).isoformat()}
    if result.get("status") == "error":
        changes["last_error"] = str(result.get("error") or "")
    save_config(changes, audit=False)
    return result


async def handle_chat_completed(event: Any) -> None:
    payload = event.payload if isinstance(event.payload, dict) else {}
    if payload.get("transport") != "telegram" or payload.get("pending"):
        return
    await send_reply(
        str(payload.get("content") or ""),
        correlation_id=str(event.correlation_id or ""),
    )


async def handle_approve_completed(event: Any) -> None:
    payload = event.payload if isinstance(event.payload, dict) else {}
    if payload.get("pending") or not payload.get("assistant_message"):
        return
    approval_id = str(payload.get("approval_id") or "")
    correlation_id = read_ports.approval_correlation_id(approval_id)
    if not correlation_id.startswith("telegram:"):
        return
    await send_reply(
        str(payload["assistant_message"]),
        correlation_id=correlation_id,
    )
