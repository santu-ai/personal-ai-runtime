"""LLM-assisted inbox classification and its defensive parsing rules."""

from __future__ import annotations

import json as _stdlib_json
import logging
import re
from types import ModuleType

from app.config import settings

try:
    import orjson as _orjson

    _json: ModuleType = _orjson
except ImportError:  # pragma: no cover
    _json = _stdlib_json

logger = logging.getLogger(__name__)

CLASSIFY_SYSTEM_PROMPT = """你是一个邮件分类助手。将每封邮件分为以下类别之一：
- important: 需要用户尽快关注（老板、客户、紧急事项、验证码、账单等）
- actionable: 需要后续处理但非紧急（待办、会议邀请、项目更新等）
- ignorable: 可忽略（营销、订阅、通知类群发等）

输出严格 JSON：
{
  "emails": [
    {
      "message_id": "与输入一致",
      "category": "important|actionable|ignorable",
      "importance": 0.0-1.0,
      "reason": "一句话中文理由"
    }
  ]
}"""


def _json_dumps_str(data: dict) -> str:
    raw = _json.dumps(data)
    return raw.decode("utf-8") if isinstance(raw, bytes) else raw


def _format_emails_for_llm(emails: list[dict]) -> str:
    lines = []
    for email in emails:
        subject = str(email.get("subject", ""))[:100]
        preview = str(email.get("preview", ""))[:200]
        lines.append(_json_dumps_str({
            "message_id": email.get("message_id", ""),
            "from": email.get("from", ""),
            "subject": subject if len(subject) < 100 else subject[:97] + "...",
            "preview": preview if len(preview) < 200 else preview[:197] + "...",
            "date": email.get("date", ""),
        }))
    return "\n".join(lines)


async def classify_emails(emails: list[dict]) -> list[dict]:
    if not emails:
        return []
    from app.core.agents.brain_llm_ops import complete_text_with_failover

    messages = [
        {"role": "system", "content": CLASSIFY_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"请分类以下邮件：\n\n{_format_emails_for_llm(emails)}\n\n请以 JSON 格式输出。",
        },
    ]
    try:
        raw, _provider = await complete_text_with_failover(
            messages,
            purpose="inbox_classify",
            actor="inbox",
            temperature=0.2,
            max_tokens=settings.llm_max_tokens,
        )
    except Exception as exc:
        logger.error("Inbox classification failed: %s", exc)
        return _fallback_classification(emails, "分类失败，默认需跟进")
    return _parse_classification(raw, emails)


def _fallback_classification(emails: list[dict], reason: str) -> list[dict]:
    return [
        {
            "message_id": email.get("message_id", ""),
            "category": "actionable",
            "importance": 0.5,
            "reason": reason,
        }
        for email in emails
    ]


def _parse_classification(raw: str, fallback_emails: list[dict]) -> list[dict]:
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned).strip()
        data = _json.loads(cleaned)
        items = data.get("emails", data) if isinstance(data, dict) else data
        if isinstance(items, list) and items:
            return items
    except Exception as exc:
        logger.error("Failed to parse classification JSON: %s. Raw: %s", exc, raw)
    return _fallback_classification(fallback_emails, "无法解析分类结果")
