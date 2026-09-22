"""Clarification tool: the model asks, the user answers in text.

The handler is not the product path. ``ask_user`` is ``needs_user``, so the
first call defers through ``ApprovalRequested``. The approve handler writes
the user's reply as the tool result and resumes the same chat checkpoint
(ADR-R011). This function only runs if something invokes the tool directly.
"""

from __future__ import annotations

import json

ASK_USER_TOOL = "ask_user"
ANSWER_MAX_CHARS = 8000


def handle_ask_user(question: str = "", context: str = "") -> str:
    """Refuse to invent an answer. The user reply is applied on approval."""
    return json.dumps(
        {
            "status": "error",
            "error": "ask_user waits for a user reply and is not executed as a side effect",
            "question": question,
            "context": context,
        },
        ensure_ascii=False,
    )


def question_from_args(tool_args: dict | None) -> str:
    if not isinstance(tool_args, dict):
        return ""
    return str(tool_args.get("question") or "").strip()


def answered_result(question: str, answer: str) -> str:
    return json.dumps(
        {
            "status": "answered",
            "question": question,
            "answer": answer,
        },
        ensure_ascii=False,
    )


def cancelled_result(question: str) -> str:
    return json.dumps(
        {
            "status": "denied",
            "reason": "user_cancelled",
            "tool_name": ASK_USER_TOOL,
            "question": question,
        },
        ensure_ascii=False,
    )


def cancelled_note(question: str) -> str:
    text = question.strip()
    if not text:
        return "已取消澄清，没有继续这次提问。"
    preview = text if len(text) <= 80 else text[:80] + "…"
    return f"已取消澄清「{preview}」，没有继续这次提问。"
