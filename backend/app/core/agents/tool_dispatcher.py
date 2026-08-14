"""ToolDispatcher — batch tool call processing extracted from Brain.

Handles capability invocation, approval, result collection, and message building.
Decoupled from Brain so new capability types (computer_use, voice, etc.) can be
added without modifying the core reasoning loop.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any, AsyncIterator

from app.core.agents.tool_postprocess import compact_for_llm

if TYPE_CHECKING:
    from app.core.agents.conversation import ConversationManager

logger = logging.getLogger(__name__)


class ToolDispatcher:
    """Process a batch of LLM-requested tool calls through the Runtime."""

    def __init__(self, *, kernel: Any, conversation: "ConversationManager"):
        self._kernel = kernel
        self._conversation = conversation

    async def dispatch(
        self,
        tool_calls_data: list[dict],
        *,
        correlation_id: str = "",
        execution_id: str = "",
    ) -> AsyncIterator[dict]:
        """Process tool calls one by one, yielding stream events.

        Yields:
            {"type": "tool_call_start", "tool_calls": [...]}
            {"type": "tool_result", "tool_name": ..., "tool_call_id": ..., "content": ...}
            {"type": "confirmation_required", ...}
            {"type": "done"} — after yielding confirmation_required

        Returns via final yield a synthetic event when done:
            {"type": "_dispatcher_done", "results": [...], "tool_messages": [...]}
        """
        from app.core.runtime.execution import get_current_execution_id
        from app.core.runtime.plan_resume import (
            lookup_chat_tool_success,
            record_chat_tool_success,
        )
        from app.core.runtime.taint import is_write_class_tool

        exec_id = execution_id or get_current_execution_id() or ""

        results: list[dict] = []
        tool_messages: list[dict] = []
        suspended = False

        for tc in tool_calls_data:
            tool_name = tc["function_name"]
            try:
                tool_args = json.loads(tc["arguments"]) if tc["arguments"] else {}
            except json.JSONDecodeError:
                tool_args = {}

            # 合成幂等键（与 plan 步骤 E-1 同款模式）：chat 轮被中断后重放时，
            # 同一 correlation 内相同的 write-class 调用直接复用已记录的成功
            # 结果，避免重复外部副作用（邮件重发、重复写文件）。只限
            # write-class：读类工具缓存会在同轮「写后读」时返回陈旧内容。
            cached: str | None = None
            idem_eligible = bool(correlation_id) and is_write_class_tool(tool_name)
            if idem_eligible:
                try:
                    cached = lookup_chat_tool_success(
                        correlation_id, tool_name, tool_args, kernel=self._kernel,
                    )
                except Exception:
                    logger.debug("chat idempotency lookup failed", exc_info=True)

            if cached is not None:
                cap_result = {"status": "success", "result": cached}
            else:
                cap_result = await self._kernel.invoke_capability(
                    name=tool_name,
                    args=tool_args,
                    actor="brain",
                    correlation_id=correlation_id,
                    execution_id=exec_id,
                )

            if cap_result["status"] == "pending":
                # Suspend only this tool for approval; keep executing the rest
                # of the batch so unrelated tools are not dropped.
                suspended = True
                yield {
                    "type": "confirmation_required",
                    "tool_name": tool_name,
                    "tool_args": tool_args,
                    "tool_call_id": tc["id"],
                    "approval_id": cap_result["approval_id"],
                }
                continue

            elif cap_result["status"] == "success":
                tool_result = cap_result["result"]
                if idem_eligible and cached is None:
                    try:
                        record_chat_tool_success(
                            correlation_id, tool_name, tool_args, tool_result,
                            kernel=self._kernel,
                        )
                    except Exception:
                        logger.debug("chat idempotency record failed", exc_info=True)
                yield {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                }
            else:
                tool_result = json.dumps({
                    "status": "error",
                    "error": cap_result.get("error", "unknown"),
                })
                yield {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                }

            results.append({
                "tool_name": tool_name,
                "tool_call_id": tc["id"],
                "content": tool_result,
            })

            tool_messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": compact_for_llm(tool_name, tool_result),
            })

            self._conversation.save_tool_result(tool_result, tc["id"])

        # Caller must suspend the turn when any tool awaits approval.
        if suspended:
            yield {"type": "done"}

        # Signal completion via a special internal event
        yield {
            "type": "_dispatcher_done",
            "results": results,
            "tool_messages": tool_messages,
        }

    def build_tool_call_messages(
        self, assistant_content: str, tool_calls_data: list[dict]
    ) -> list[dict]:
        """Build assistant + tool result messages for the LLM context."""
        msgs: list[dict] = []
        assistant_msg: dict = {"role": "assistant", "content": assistant_content or None}
        tc_for_msg = []
        for tc in tool_calls_data:
            tc_for_msg.append({
                "id": tc["id"],
                "type": "function",
                "function": {"name": tc["function_name"], "arguments": tc["arguments"]},
            })
        assistant_msg["tool_calls"] = tc_for_msg
        msgs.append(assistant_msg)
        return msgs
