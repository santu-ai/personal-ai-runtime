"""Brain streaming chat loop — extracted from brain.py.

Not counted toward God Object LOC (Architecture Contract only measures
``brain.py`` + ``brain_llm_client.py``).

Stream chunk assembly lives in ``brain_stream_assemble``; this module owns
the LLM → tool → continue control loop.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import AsyncIterator

from app.config import settings
from app.core.agents.brain_stream_assemble import AssembledStream, iter_assembled_stream
from app.core.agents.brain_telemetry import record_llm_call
from app.core.agents.conversation import ConversationManager
from app.core.agents.tool_dispatcher import ToolDispatcher
from app.core.agents.tool_postprocess import canned_summary, compact_for_llm
from app.core.runtime.governance.context_pipeline import get_sources
from app.core.runtime.kernel_instance import kernel
from app.core.runtime.plan_resume import (
    clear_chat_checkpoint,
    load_chat_checkpoint,
    record_chat_checkpoint,
)
from app.core.runtime.taint import taint_registry

logger = logging.getLogger(__name__)

_TOKEN_CAP_NOTE = "\n\n（已达本轮工具调用的 token 上限，以上为根据已收集信息生成的回复。）"
_ITER_CAP_NOTE = "\n\n（已达工具调用次数上限，以上为根据已收集信息生成的回复。）"
_DISPATCHER_INTERNAL = frozenset({"_dispatcher_done", "done"})


async def chat_stream(
    brain,
    conversation: ConversationManager,
    user_message: str,
    *,
    system_prompt: str,
    execution_id: str = "",
    correlation_id: str = "",
) -> AsyncIterator[dict]:
    """Process a user message and stream the response.

    system_prompt must be pre-compiled by PromptCompiler before calling Brain.

    correlation_id is used to track the taint chain across tool calls and
    approval recovery. When provided (e.g. from scheduler ExecutionContext),
    it replaces the internally-generated default to keep taint propagation
    consistent (INV-8).
    """
    if not correlation_id:
        correlation_id = f"chat-{uuid.uuid4().hex[:16]}"
    conversation.correlation_id = correlation_id

    ckpt: dict | None = None
    try:
        ckpt = load_chat_checkpoint(correlation_id, kernel=kernel)
    except Exception:
        logger.debug("chat checkpoint load failed", exc_info=True)

    restored = bool(ckpt and isinstance(ckpt.get("messages"), list) and ckpt["messages"])
    taint_registry.clear(correlation_id)
    resume_after_approval = False
    if restored:
        assert ckpt is not None
        if ckpt.get("tainted"):
            taint_registry.mark(
                correlation_id,
                source="external_ingestion",
                reason="chat_ckpt",
            )
        messages = list(ckpt["messages"])
        tool_iterations = int(ckpt.get("iteration") or 0)
        saved_user = str(ckpt.get("user_message") or "")
        if saved_user:
            user_message = saved_user
        all_tc_for_msg = list(ckpt.get("tool_calls") or [])
        resume_after_approval = bool(ckpt.get("resume_after_approval"))
        if resume_after_approval:
            # Prior assistant+tool_calls already persisted; only save new turns.
            all_tc_for_msg = []
    else:
        messages = brain.build_messages(conversation, user_message, system_prompt=system_prompt)
        tool_iterations = 0
        all_tc_for_msg = []
    # E-8: save_user_message is idempotent per correlation_id so scheduler
    # retries of ChatRequested do not duplicate the user turn.
    conversation.save_user_message(user_message)

    still_waiting = bool(
        restored
        and ckpt is not None
        and ckpt.get("status") == "awaiting_approval"
        and ckpt.get("pending_tool_call_ids")
    )
    if still_waiting:
        yield {"type": "done"}
        return

    def _persist_checkpoint() -> None:
        try:
            record_chat_checkpoint(
                correlation_id,
                {
                    "conversation_id": conversation.conversation_id,
                    "user_message": user_message,
                    "messages": messages,
                    "iteration": tool_iterations,
                    "status": "in_progress",
                    "tainted": taint_registry.is_tainted(correlation_id),
                    "tool_calls": all_tc_for_msg,
                },
                kernel=kernel,
            )
        except Exception:
            logger.debug("chat checkpoint save failed", exc_info=True)

    def _drop_checkpoint() -> None:
        try:
            clear_chat_checkpoint(correlation_id, kernel=kernel)
        except Exception:
            logger.debug("chat checkpoint clear failed", exc_info=True)

    full_content = ""
    cumulative_prompt_tokens = 0
    loop_start = time.time()
    at_iteration_cap = (
        resume_after_approval and tool_iterations >= settings.max_tool_iterations
    )

    while tool_iterations < settings.max_tool_iterations:
        if time.time() - loop_start > settings.total_tool_loop_timeout:
            yield {"type": "error", "content": "Tool call loop timed out."}
            if resume_after_approval:
                _persist_checkpoint()
            else:
                _drop_checkpoint()
            return
        if cumulative_prompt_tokens >= settings.max_tool_loop_prompt_tokens:
            yield {"type": "text_delta", "content": _TOKEN_CAP_NOTE}
            full_content += _TOKEN_CAP_NOTE
            break

        llm_start = time.time()
        try:
            response, client, used_provider = await brain.llm.create_stream(messages)
        except Exception as e:
            yield {"type": "error", "content": f"LLM API error: {str(e)}"}
            if resume_after_approval:
                _persist_checkpoint()
            else:
                _drop_checkpoint()
            return
        if used_provider.name != brain.llm.provider.name:
            brain.llm.replace_provider(client, used_provider)

        assembled: AssembledStream | None = None
        async for evt in iter_assembled_stream(response):
            if evt.get("type") == "_stream_assembled":
                assembled = evt["result"]
            else:
                yield evt

        if assembled is None:
            yield {"type": "error", "content": "LLM stream ended without a result."}
            if resume_after_approval:
                _persist_checkpoint()
            else:
                _drop_checkpoint()
            return

        assistant_content = assembled.visible_text
        tool_calls_data = assembled.tool_calls

        turn_tokens = record_llm_call(
            messages, assistant_content, llm_start,
            provider_name=used_provider.name,
            provider_model=used_provider.model,
            price_per_prompt_token=used_provider.price_per_prompt_token,
            price_per_completion_token=used_provider.price_per_completion_token,
            usage=assembled.usage,
        )
        cumulative_prompt_tokens += turn_tokens

        if not tool_calls_data:
            full_content = assistant_content
            if not full_content.strip() and user_message.strip():
                # Second LLM pass only when the first stream was empty — skip
                # whitespace-only user turns to avoid burning tokens on noise.
                try:
                    full_content = await asyncio.wait_for(
                        brain.llm.complete_text_only(messages, user_message),
                        timeout=settings.complete_text_only_timeout,
                    )
                except TimeoutError:
                    logger.warning("complete_text_only timed out")
                    full_content = ""
                if full_content:
                    yield {"type": "text_delta", "content": full_content}
            break

        yield {"type": "tool_call_start", "tool_calls": tool_calls_data}

        dispatcher = ToolDispatcher(kernel=kernel, conversation=conversation)
        iteration_tool_results: list[dict] = []
        pending_ids: list[str] = []
        _tool_messages: list[dict] = []

        async for evt in dispatcher.dispatch(
            tool_calls_data,
            correlation_id=correlation_id,
            execution_id=execution_id or "",
        ):
            evt_type = evt.get("type")
            if evt_type == "_dispatcher_done":
                iteration_tool_results = evt.get("results", [])
                _tool_messages = evt.get("tool_messages", [])
            elif evt_type == "confirmation_required":
                tool_call_id = str(evt.get("tool_call_id") or "")
                if tool_call_id:
                    pending_ids.append(tool_call_id)
                yield evt
            elif evt_type not in _DISPATCHER_INTERNAL:
                yield evt

        if pending_ids:
            # Persist assistant tool_calls and keep the checkpoint so approve
            # can resume this same tool loop (ADR-R011).
            tc_for_msg = [{
                "id": tc["id"], "type": "function",
                "function": {"name": tc["function_name"], "arguments": tc["arguments"]},
            } for tc in tool_calls_data]
            conversation.save_assistant_message(
                assistant_content or "",
                tool_calls=tc_for_msg,
            )
            messages.extend(dispatcher.build_tool_call_messages(assistant_content, tool_calls_data))
            messages.extend(_tool_messages)
            try:
                record_chat_checkpoint(
                    correlation_id,
                    {
                        "conversation_id": conversation.conversation_id,
                        "user_message": user_message,
                        "messages": messages,
                        "iteration": tool_iterations,
                        "status": "awaiting_approval",
                        "tainted": taint_registry.is_tainted(correlation_id),
                        "tool_calls": all_tc_for_msg + tc_for_msg,
                        "pending_tool_call_ids": pending_ids,
                    },
                    kernel=kernel,
                )
            except Exception:
                logger.debug("chat checkpoint save failed", exc_info=True)
            return

        tc_for_msg = [{
            "id": tc["id"], "type": "function",
            "function": {"name": tc["function_name"], "arguments": tc["arguments"]},
        } for tc in tool_calls_data]

        all_tc_for_msg.extend(tc_for_msg)

        messages.extend(dispatcher.build_tool_call_messages(assistant_content, tool_calls_data))
        messages.extend(_tool_messages)
        _persist_checkpoint()

        summary = canned_summary(tool_calls_data, iteration_tool_results)
        if summary:
            full_content = summary
            yield {"type": "text_delta", "content": full_content}
            break

        tool_iterations += 1
        if tool_iterations >= settings.max_tool_iterations:
            if assistant_content:
                full_content = assistant_content
                yield {"type": "text_delta", "content": assistant_content}
            else:
                synthesized = await brain.llm.synthesize_from_tool_results(messages)
                if synthesized:
                    full_content = synthesized
                    yield {"type": "text_delta", "content": synthesized}
            if full_content:
                full_content += _ITER_CAP_NOTE
                yield {"type": "text_delta", "content": _ITER_CAP_NOTE}
            else:
                yield {
                    "type": "error",
                    "content": "达到了最大工具调用次数，且无法根据已有结果生成回复。",
                }
            break

    if at_iteration_cap and not full_content:
        synthesized = await brain.llm.synthesize_from_tool_results(messages)
        if synthesized:
            full_content = synthesized + _ITER_CAP_NOTE
            yield {"type": "text_delta", "content": synthesized}
            yield {"type": "text_delta", "content": _ITER_CAP_NOTE}
        else:
            yield {
                "type": "error",
                "content": "达到了最大工具调用次数，且无法根据已有结果生成回复。",
            }
            _persist_checkpoint()
            return

    if full_content or all_tc_for_msg:
        try:
            sources = get_sources(conversation.conversation_id)
        except Exception:
            sources = None
        conversation.save_assistant_message(
            full_content or "",
            tool_calls=all_tc_for_msg if all_tc_for_msg else None,
            sources=sources,
        )

    _drop_checkpoint()
    yield {"type": "done"}


def chat_correlation_for_approval(approval_id: str) -> str:
    """Return the originating Chat correlation_id for an ApprovalRequested event."""
    from app.core.runtime.plan_resume import approval_correlation_id

    return approval_correlation_id(approval_id, kernel=kernel)


def append_approved_tool_to_checkpoint(
    correlation_id: str,
    *,
    tool_call_id: str,
    tool_name: str,
    result_str: str,
) -> dict | None:
    """Attach an approved tool result to the waiting chat checkpoint.

    Returns the updated payload, or None when no checkpoint exists (caller
    should fall back to one-shot text continuation).
    """
    if not correlation_id:
        return None
    try:
        ckpt = load_chat_checkpoint(correlation_id, kernel=kernel)
    except Exception:
        logger.debug("chat checkpoint load failed", exc_info=True)
        return None
    if not ckpt:
        return None
    messages = list(ckpt.get("messages") or [])
    messages.append({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": compact_for_llm(tool_name, result_str),
    })
    pending = [
        pid for pid in list(ckpt.get("pending_tool_call_ids") or [])
        if pid != tool_call_id
    ]
    ckpt["messages"] = messages
    ckpt["pending_tool_call_ids"] = pending
    if pending:
        ckpt["status"] = "awaiting_approval"
        ckpt["resume_after_approval"] = False
    else:
        ckpt["status"] = "in_progress"
        ckpt["resume_after_approval"] = True
        ckpt["iteration"] = int(ckpt.get("iteration") or 0) + 1
        ckpt["tool_calls"] = []
    try:
        record_chat_checkpoint(correlation_id, ckpt, kernel=kernel)
    except Exception:
        logger.debug("chat checkpoint save failed", exc_info=True)
        return None
    return ckpt


async def resume_after_approved_tool(
    brain,
    conversation: ConversationManager,
    *,
    correlation_id: str,
    execution_id: str = "",
) -> dict:
    """Resume the Chat tool loop after an approved tool result is persisted."""
    user_message = ""
    try:
        ckpt = load_chat_checkpoint(correlation_id, kernel=kernel)
    except Exception:
        ckpt = None
    if ckpt:
        user_message = str(ckpt.get("user_message") or "")

    from app.chat.prompt_compiler import CompileContext, prompt_compiler

    system_prompt = await prompt_compiler.compile(
        CompileContext(
            conversation_id=conversation.conversation_id,
            execution_id=execution_id or None,
            user_message=user_message,
            stage="post_tool",
        ),
    )

    content = ""
    pending_data: dict = {}
    tool_results: list[dict] = []
    error_content = ""
    async for evt in chat_stream(
        brain,
        conversation,
        user_message,
        system_prompt=system_prompt,
        execution_id=execution_id,
        correlation_id=correlation_id,
    ):
        evt_type = evt.get("type")
        if evt_type == "text_delta" and evt.get("content"):
            content += evt["content"]
        elif evt_type == "tool_result":
            tool_results.append({
                "tool_name": evt.get("tool_name", ""),
                "tool_call_id": evt.get("tool_call_id", ""),
                "content": evt.get("content", ""),
            })
        elif evt_type == "confirmation_required":
            pending_data = {
                "tool_name": evt.get("tool_name", ""),
                "tool_args": evt.get("tool_args") or {},
                "tool_call_id": evt.get("tool_call_id", ""),
                "approval_id": evt.get("approval_id", ""),
            }
        elif evt_type == "error":
            error_content = evt.get("content", "Error")
            break

    return {
        "assistant_message": content,
        "pending": bool(pending_data.get("approval_id")),
        "tool_name": pending_data.get("tool_name", ""),
        "tool_args": pending_data.get("tool_args") or {},
        "approval_id": pending_data.get("approval_id", ""),
        "tool_call_id": pending_data.get("tool_call_id", ""),
        "tool_results": tool_results,
        "error": error_content,
    }
