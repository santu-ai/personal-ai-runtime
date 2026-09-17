"""ApproveRequested handler — resolve pending approvals via Scheduler.

Lives in runtime.handlers (orchestration), not agents.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from app.core.runtime.handler_registry import subscribe
from app.core.runtime.plan_resume import (
    PlanResume,
    lookup_action_step_success,
    lookup_step_success,
    peek_plan_resume,
    record_chat_tool_success,
    record_step_success,
    register_plan_resume,
    take_plan_resume,
)

if TYPE_CHECKING:
    from app.core.runtime.execution import ExecutionContext
    from app.core.runtime.kernel.event import Event

logger = logging.getLogger(__name__)


def _dispatch_plan_resume(
    ctx: "ExecutionContext",
    event: "Event",
    resume: PlanResume,
) -> bool:
    """Re-enqueue the remainder of an execute plan after approval.

    Returns True when a resume event was emitted.
    """
    if resume.kind == "execute" and resume.action_id:
        ctx.emit(
            "ExecuteRequested",
            "action",
            f"exec_{resume.action_id}",
            payload={
                "action_id": resume.action_id,
                "resume_from": resume.resume_from,
                "previous_output": resume.previous_output or {},
            },
            caused_by=event.id,
        )
        return True
    logger.error(
        "Approve: plan resume missing action_id (kind=%s)", resume.kind
    )
    return False


def _denied_user_note(tool_name: str) -> str:
    if tool_name:
        return f"已拒绝「{tool_name}」，没有执行该操作。"
    return "已拒绝该操作。"


def _persist_denied_chat_turn(
    conv_id: str,
    tool_call_id: str,
    tool_name: str,
    correlation_id: str | None,
) -> str:
    """Record the denied tool call in the conversation without calling the LLM.

    Approve path persists via save_tool_result + continue_after_tool_result.
    Deny previously only flipped the approval row, so a refresh left a hanging
    tool_call and a blank turn.
    """
    from app.core.agents.conversation import ConversationManager

    conversation = ConversationManager(
        conversation_id=conv_id,
        correlation_id=correlation_id or None,
    )
    conversation.save_tool_result(
        json.dumps({
            "status": "denied",
            "reason": "user_denied",
            "tool_name": tool_name,
        }),
        tool_call_id,
        tool_name=tool_name,
    )
    note = _denied_user_note(tool_name)
    conversation.save_assistant_message(note)
    return note


@subscribe("ApproveRequested")
async def on_approve_requested(ctx: "ExecutionContext", event: "Event") -> None:
    """Resolve a pending approval (approve or deny) via Scheduler."""
    from app.core.runtime.kernel_instance import kernel

    approval_id = event.payload.get("approval_id", "")
    decision = event.payload.get("decision", "deny")
    tool_name = event.payload.get("tool_name", "")
    tool_args = event.payload.get("tool_args", {})
    conv_id = event.payload.get("conv_id", "")
    tool_call_id = event.payload.get("tool_call_id", "")

    if not approval_id:
        ctx.emit(
            "ApproveCompleted", "approval", f"approve_{approval_id}",
            payload={"status": "error", "error": "missing approval_id"},
            caused_by=event.id,
        )
        return

    pending_resume = peek_plan_resume(approval_id, kernel=kernel)
    cached_plan_result: str | None = None
    if pending_resume is not None:
        approved_step = max(int(pending_resume.resume_from) - 1, 0)
        cached_plan_result = lookup_action_step_success(
            pending_resume.action_id, approved_step, kernel=kernel,
        )
        if cached_plan_result is None:
            cached_plan_result = lookup_step_success(
                ctx.correlation_id or "", approved_step, kernel=kernel,
            )

    if decision == "deny":
        take_plan_resume(approval_id, kernel=kernel)  # drop any queued plan resume
        kernel.deny_approval(approval_id, action=tool_name, actor="user", reason="user_denied")
        assistant_message = ""
        from app.core.runtime.plan_resume import clear_chat_checkpoint_for_approval

        chat_corr = clear_chat_checkpoint_for_approval(
            approval_id, kernel=kernel,
        ) or ctx.correlation_id
        if conv_id and tool_call_id:
            try:
                assistant_message = _persist_denied_chat_turn(
                    conv_id, tool_call_id, tool_name, chat_corr,
                )
            except Exception as exc:
                logger.warning("Approve: persist denied chat turn failed: %s", exc)
        ctx.emit(
            "ApproveCompleted", "approval", f"approve_{approval_id}",
            payload={
                "status": "denied",
                "approval_id": approval_id,
                "conv_id": conv_id,
                "tool_call_id": tool_call_id,
                "assistant_message": assistant_message,
            },
            caused_by=event.id,
        )
        return

    if cached_plan_result is not None:
        cap_result = {"status": "success", "result": cached_plan_result}
    else:
        cap_result = await kernel.invoke_capability(
            name=tool_name,
            args=tool_args,
            actor="user",
            pre_approved=True,
            approval_id=approval_id,
            execution_id=ctx.execution_id,
            correlation_id=ctx.correlation_id,
        )
    if cap_result["status"] == "success":
        result_str = cap_result["result"]
    else:
        result_str = json.dumps({
            "status": cap_result.get("status", "error"),
            "error": cap_result.get("error", "unknown"),
        })

    assistant_message = ""
    continuation: dict = {}
    if conv_id and tool_call_id:
        from app.core.agents.brain import Brain
        from app.core.agents.brain_chat_stream import (
            append_approved_tool_to_checkpoint,
            chat_correlation_for_approval,
            resume_after_approved_tool,
        )
        from app.core.agents.conversation import ConversationManager
        from app.core.runtime.taint import is_write_class_tool

        chat_corr = chat_correlation_for_approval(approval_id) or (ctx.correlation_id or "")
        conversation = ConversationManager(
            conversation_id=conv_id,
            correlation_id=chat_corr or None,
        )
        row = conversation.save_tool_result(
            result_str, tool_call_id, tool_name=tool_name,
        )
        if cap_result["status"] == "success" and chat_corr and is_write_class_tool(tool_name):
            try:
                record_chat_tool_success(
                    chat_corr, tool_name, tool_args, result_str, kernel=kernel,
                )
            except Exception:
                logger.debug("Approve: chat idempotency record failed", exc_info=True)

        llm_content = (row or {}).get("content") or result_str
        ckpt = append_approved_tool_to_checkpoint(
            chat_corr,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            result_str=llm_content,
        ) if chat_corr else None
        brain = Brain()
        try:
            if ckpt is not None and not ckpt.get("pending_tool_call_ids"):
                continuation = await resume_after_approved_tool(
                    brain,
                    conversation,
                    correlation_id=chat_corr,
                    execution_id=ctx.execution_id or "",
                )
                assistant_message = continuation.get("assistant_message") or ""
            elif ckpt is None:
                assistant_message = await brain.continue_after_tool_result(conversation)
        except Exception as exc:
            logger.warning("Approve: conversation resume failed: %s", exc)
            continuation = {"error": str(exc)}

    # After the approved tool runs, continue any paused execute/background plan.
    # E-6: take first (atomic claim) so concurrent Approve cannot double-resume;
    # re-register on dispatch failure so a retry can succeed.
    plan_resumed = False
    if cap_result["status"] == "success":
        pending = peek_plan_resume(approval_id, kernel=kernel)
        if pending is not None:
            approved_step = max(int(pending.resume_from) - 1, 0)
            record_step_success(
                ctx.correlation_id or "",
                approved_step,
                result_str,
                action_id=pending.action_id,
                kernel=kernel,
            )
        resume = take_plan_resume(approval_id, kernel=kernel)
        if resume is not None:
            approved_step = max(resume.resume_from - 1, 0)
            updated = resume.with_step_output(approved_step, result_str)
            try:
                if _dispatch_plan_resume(ctx, event, updated):
                    plan_resumed = True
                # Invalid resume (no action_id) — already taken, leave dropped.
            except Exception:
                logger.exception(
                    "Approve: failed to dispatch plan resume for %s", approval_id
                )
                register_plan_resume(approval_id, updated, kernel=kernel)
    else:
        take_plan_resume(approval_id, kernel=kernel)

    ctx.emit(
        "ApproveCompleted", "approval", f"approve_{approval_id}",
        payload={
            "status": cap_result["status"],
            "result": result_str,
            "approval_id": approval_id,
            "conv_id": conv_id,
            "tool_call_id": tool_call_id,
            "assistant_message": assistant_message or "",
            "plan_resumed": plan_resumed,
            "pending": bool(continuation.get("pending")),
            "next_tool_name": continuation.get("tool_name") or "",
            "next_tool_args": continuation.get("tool_args") or {},
            "next_approval_id": continuation.get("approval_id") or "",
            "next_tool_call_id": continuation.get("tool_call_id") or "",
            "tool_results": continuation.get("tool_results") or [],
            "resume_error": continuation.get("error") or "",
        },
        caused_by=event.id,
    )
