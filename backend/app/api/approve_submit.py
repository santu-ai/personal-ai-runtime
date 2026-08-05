"""Shared ApproveRequested submit_command helper for chat + approvals APIs."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.config import settings
from app.core.runtime.kernel_instance import ensure_runtime_scheduler, get_runtime_scheduler, kernel


async def submit_approve_requested(
    approval_id: str,
    *,
    decision: str,
    tool_name: str,
    tool_args: dict[str, Any] | None = None,
    conv_id: str = "",
    tool_call_id: str = "",
) -> dict[str, Any]:
    """Ensure scheduler is up, then wait for ApproveRequested completion."""
    await ensure_runtime_scheduler()
    scheduler = get_runtime_scheduler()
    await scheduler.start()

    result = await kernel.submit_command(
        "ApproveRequested",
        "approval",
        f"approve_{approval_id}",
        payload={
            "approval_id": approval_id,
            "decision": decision,
            "tool_name": tool_name,
            "tool_args": tool_args or {},
            "conv_id": conv_id or "",
            "tool_call_id": tool_call_id or "",
        },
        actor="user",
        timeout=settings.submit_command_timeout_approval,
    )

    if result.get("error") == "timeout":
        raise HTTPException(status_code=504, detail="Approval resolution timed out")
    return result
