"""Inbox API — proactive inbox app read surface."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.product.inbox import (
    generate_inbox_digest,
    latest_digest,
    list_inbox_emails,
    mark_inbox_email_status,
    poll_inbox,
)

import asyncio

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
    from app.core.harness.builtin_tools.email import email_server
    from app.core.runtime.read_ports.inbox import query_inbox_email
    from app.core.runtime.runtime_config import runtime_config

    row = query_inbox_email(email_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Email not found")

    # Fetch full body from IMAP for accurate summarization.
    body = email_server.read_email_body(email_id)
    if not body or not body.strip():
        # Fall back to the poll-time preview when IMAP body is unavailable.
        body = (row.get("preview") or "")

    # Build a single-turn chat completion for summarization.
    # masked=False is required: we need the real API key to call the LLM.
    llm_config = runtime_config.get_llm_config(masked=False)
    providers = llm_config.get("providers", [])
    primary = next((p for p in providers if p.get("enabled")), None)
    if not primary:
        raise HTTPException(status_code=503, detail="No enabled LLM provider configured")

    api_key = str(primary.get("api_key") or "")
    if not api_key and primary.get("type") != "ollama":
        raise HTTPException(status_code=503, detail="LLM API key not configured")
    # Ollama doesn't require an API key, but openai SDK warns on empty strings.
    if not api_key:
        api_key = "ollama"

    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=str(primary.get("base_url", "")),
        timeout=EMAIL_SUMMARY_TIMEOUT,
    )
    model = str(primary.get("model", "deepseek-chat"))

    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "user", "content": f"{EMAIL_SUMMARY_PROMPT}\n发件人: {row.get('sender', '')}\n主题: {row.get('subject', '')}\n\n{body}"},
                ],
                temperature=0.3,
                max_tokens=300,
            ),
            timeout=EMAIL_SUMMARY_TIMEOUT,
        )
        summary = response.choices[0].message.content or ""
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Summary generation timed out")
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
