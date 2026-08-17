"""Inbox API — proactive inbox app read surface."""

import asyncio
import json
import re

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.product.inbox import (
    generate_inbox_digest,
    inbox_sync_status,
    latest_digest,
    list_inbox_emails,
    mark_inbox_email_status,
    poll_inbox,
)

router = APIRouter(tags=["inbox"])


EMAIL_SUMMARY_PROMPT = (
    "请用中文总结以下邮件内容，不超过 150 字，"
    "突出关键信息（发件人意图、需要采取的行动、截止日期等）：\n\n"
)

# Timeout for the LLM summarization call.
EMAIL_SUMMARY_TIMEOUT = 15  # seconds


class UpdateInboxStatusRequest(BaseModel):
    status: str = Field(pattern="^(pending|read|handled)$")


@router.get("/")
async def get_inbox(
    category: str | None = Query(None, pattern="^(important|actionable|ignorable)$"),
    limit: int = Query(50, ge=1, le=200),
    status: str = Query("pending", pattern="^(pending|read|handled|all)$"),
):
    if status == "all":
        return list_inbox_emails(category=category, limit=limit, status="all")
    return list_inbox_emails(category=category, limit=limit, status=status)


@router.get("/digest")
async def get_digest():
    digest = latest_digest()
    return digest or {"message": "no digest yet"}


@router.post("/poll")
async def trigger_poll(limit: int = Query(20, ge=1, le=50)):
    return await poll_inbox(limit=limit)


@router.get("/sync-status")
async def get_sync_status():
    """Last InboxPollCompleted plus reconstructed poll/duplicate/read-sync metrics."""
    return inbox_sync_status()


@router.post("/digest")
async def trigger_digest():
    digest = generate_inbox_digest()
    return digest or {"message": "no emails to digest"}


@router.patch("/{email_id}/status")
async def update_inbox_status(email_id: str, body: UpdateInboxStatusRequest):
    try:
        result = await mark_inbox_email_status(email_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Email not found")
    return result


@router.get("/{email_id}/summary")
async def get_inbox_email_summary(email_id: str):
    """Generate an LLM summary for a single inbox email.

    Fetches the full body from IMAP, then calls the configured
    LLM to produce a concise Chinese summary.
    """
    from app.core.runtime.kernel_instance import get_current_execution_id, kernel
    from app.core.runtime.read_ports.inbox import query_inbox_email

    row = query_inbox_email(email_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Email not found")

    # 经 Kernel 治理面取 IMAP 全文正文（read_inbox_email 为 auto_allow +
    # external_ingestion，correlation_id 让外部内容正确打 taint 标记）。
    body = ""
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", email_id)[:48]
    cap = await kernel.invoke_capability(
        "read_inbox_email",
        {"message_id": email_id},
        actor="user",
        correlation_id=f"inbox_summary_{safe_id}",
        execution_id=get_current_execution_id(),
    )
    if cap.get("status") == "success":
        try:
            parsed = json.loads(cap.get("result") or "{}")
            if isinstance(parsed, dict) and not parsed.get("error"):
                body = str(parsed.get("body") or "")
        except (ValueError, TypeError):
            body = ""
    if not body.strip():
        # 正文取不到时回退到轮询期存下的 preview。
        body = (row.get("preview") or "")

    # Build a single-turn chat completion for summarization, routed through the
    # same failover + egress audit path as other LLM callers.
    messages = [
        {"role": "user", "content": (
            f"{EMAIL_SUMMARY_PROMPT}\n发件人: {row.get('sender', '')}\n"
            f"主题: {row.get('subject', '')}\n\n{body}"
        )},
    ]

    try:
        from app.core.agents.brain_llm_ops import complete_text_with_failover

        summary, _provider = await asyncio.wait_for(
            complete_text_with_failover(
                messages,
                purpose="inbox_summary",
                actor="api",
                temperature=0.3,
                max_tokens=300,
            ),
            timeout=EMAIL_SUMMARY_TIMEOUT,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Summary generation timed out") from exc
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}") from e

    return {
        "email_id": email_id,
        "subject": row.get("subject", ""),
        "sender": row.get("sender", ""),
        "summary": summary.strip(),
    }


@router.get("/{email_id}")
async def get_inbox_email(email_id: str):
    """Get a single inbox email with full metadata."""
    from app.core.runtime.read_ports.inbox import query_inbox_email

    row = query_inbox_email(email_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Email not found")
    return {
        "id": row.get("id", ""),
        "sender": row.get("sender", ""),
        "subject": row.get("subject", ""),
        "date": row.get("date", ""),
        "preview": row.get("preview", ""),
        "category": row.get("category", ""),
        "importance": row.get("importance", 0),
        "reason": row.get("reason", ""),
        "status": row.get("status", ""),
        "received_at": row.get("received_at", ""),
        "created_at": row.get("created_at", ""),
    }
