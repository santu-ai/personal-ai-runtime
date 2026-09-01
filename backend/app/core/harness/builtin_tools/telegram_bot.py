"""Telegram Bot MCP Server — send/receive messages via Telegram Bot API."""

import json

from app.config import settings
from app.core.harness.mcp_hub import (
    OUTCOME_TOOL_EXECUTION_FAILURE,
    ToolInvokeError,
)
from app.core.harness.url_safety import create_ssrf_safe_async_client


class TelegramBotServer:
    """Telegram Bot integration for messaging (opt-in advanced category)."""

    @staticmethod
    def _creds() -> tuple[str, str]:
        """Read token/chat_id from settings on each call (survives runtime updates)."""
        return settings.telegram_bot_token.strip(), settings.telegram_chat_id.strip()

    async def send_message(
        self,
        text: str,
        parse_mode: str = "Markdown",
        chat_id: str | None = None,
    ) -> str:
        """Send a message via Telegram Bot."""
        token, configured_chat_id = self._creds()
        if not token or not configured_chat_id:
            raise ToolInvokeError(
                OUTCOME_TOOL_EXECUTION_FAILURE,
                "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured",
            )
        target_chat_id = (chat_id or configured_chat_id).strip()
        if target_chat_id != configured_chat_id:
            raise ToolInvokeError(
                OUTCOME_TOOL_EXECUTION_FAILURE,
                "Telegram chat_id is not allowlisted",
            )

        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            async with create_ssrf_safe_async_client(timeout=10) as client:
                payload = {
                    "chat_id": target_chat_id,
                    "text": text[:4000],
                }
                if parse_mode:
                    payload["parse_mode"] = parse_mode
                resp = await client.post(url, json=payload)
                data = resp.json()
                if data.get("ok"):
                    return json.dumps({"success": True, "message_id": data["result"]["message_id"]})
                raise ToolInvokeError(
                    OUTCOME_TOOL_EXECUTION_FAILURE,
                    data.get("description", "Unknown error"),
                )
        except ToolInvokeError:
            raise
        except Exception as e:
            raise ToolInvokeError(OUTCOME_TOOL_EXECUTION_FAILURE, str(e)) from e

    async def get_updates(
        self,
        limit: int = 5,
        offset: int | None = None,
        timeout: int = 5,
    ) -> str:
        """Get recent messages sent to the bot."""
        token, configured_chat_id = self._creds()
        if not token or not configured_chat_id:
            raise ToolInvokeError(
                OUTCOME_TOOL_EXECUTION_FAILURE,
                "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured",
            )

        try:
            url = f"https://api.telegram.org/bot{token}/getUpdates"
            params = {
                "limit": max(1, min(int(limit), 100)),
                "timeout": max(0, min(int(timeout), 20)),
            }
            if offset is not None:
                params["offset"] = int(offset)
            async with create_ssrf_safe_async_client(timeout=params["timeout"] + 5) as client:
                resp = await client.get(url, params=params)
                data = resp.json()
                if data.get("ok"):
                    updates = []
                    raw_updates = data["result"]
                    next_offset = (
                        max(int(item.get("update_id") or 0) for item in raw_updates) + 1
                        if raw_updates
                        else (int(offset) if offset is not None else None)
                    )
                    for update in raw_updates:
                        msg = update.get("message", {})
                        chat_id = str((msg.get("chat") or {}).get("id") or "")
                        if chat_id != configured_chat_id:
                            continue
                        updates.append({
                            "update_id": update.get("update_id"),
                            "chat_id": chat_id,
                            "from": msg.get("from", {}).get("first_name", "Unknown"),
                            "text": msg.get("text", ""),
                            "date": msg.get("date", 0),
                        })
                    return json.dumps({
                        "count": len(updates),
                        "updates": updates,
                        "next_offset": next_offset,
                        "ignored_count": len(raw_updates) - len(updates),
                    })
                raise ToolInvokeError(
                    OUTCOME_TOOL_EXECUTION_FAILURE,
                    data.get("description", "Unknown error"),
                )
        except ToolInvokeError:
            raise
        except Exception as e:
            raise ToolInvokeError(OUTCOME_TOOL_EXECUTION_FAILURE, str(e)) from e


telegram_bot_server = TelegramBotServer()
