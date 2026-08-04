"""Brain LLM call operations — extracted from brain_llm_client.py.

Not counted toward God Object LOC.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from app.core.agents.llm_failover import llm_router
from app.core.agents.tool_markup import strip_tool_markup
from app.core.runtime.egress.egress_gate import audit_llm_egress
from app.core.runtime.kernel_instance import kernel
from app.core.runtime.runtime_config import runtime_config

if TYPE_CHECKING:
    from app.core.agents.conversation import ConversationManager

logger = logging.getLogger(__name__)


async def _complete_text(
    client: Any,
    model: str,
    messages: list[dict],
    *,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> str:
    """非流式文本补全——统一生成参数解析与调用模板。

    无 tools 的普通补全（continue/synthesize/complete_text_only）共用此路径；
    生成参数只解析一次，避免每个调用点重复调 get_generation_params()。
    返回补全文本（可能为空串）。
    """
    if temperature is None or max_tokens is None:
        gen_temp, gen_max = runtime_config.get_generation_params()
        temperature = temperature if temperature is not None else gen_temp
        max_tokens = max_tokens if max_tokens is not None else gen_max
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


async def continue_after_tool_result(
    llm, conversation: "ConversationManager", *, depth: int = 0,
) -> str:
    """One-shot LLM completion after approval resolution closes the tool loop.

    ``depth`` bounds recursive re-entry: each approval resolution may
    trigger another tool call that again needs approval, and without a
    cap the loop could recurse indefinitely.
    """
    if depth >= llm.MAX_CONTINUE_DEPTH:
        logger.warning(
            "continue_after_tool_result hit depth cap (%d); stopping",
            llm.MAX_CONTINUE_DEPTH,
        )
        return "操作已完成，但后续推理深度已达上限。"
    from app.chat.prompt_compiler import (
        CompileContext,
        latest_user_message_from_history,
        prompt_compiler,
    )

    history = conversation.get_history()
    latest_user = latest_user_message_from_history(history)
    system_prompt = await prompt_compiler.compile(
        CompileContext(
            conversation_id=conversation.conversation_id,
            execution_id=None,
            user_message=latest_user,
            stage="post_tool",
        ),
    )
    messages = llm.build_messages(
        conversation, user_message="", system_prompt=system_prompt,
    )
    if messages and messages[-1].get("role") == "user" and not messages[-1].get("content"):
        messages.pop()

    egress_messages, _egress_audit = audit_llm_egress(
        messages, purpose="chat_continue"
    )

    content = ""
    try:
        content = await _complete_text(llm.client, llm.provider.model, egress_messages)
    except Exception as e:
        logger.warning("continue_after_tool_result first attempt failed: %s", e)

    cleaned = strip_tool_markup(content)

    if not cleaned.strip():
        original_raw = content[:200] if content else "(empty)"
        logger.warning(
            "continue_after_tool_result: empty after strip, raw=%r — retrying",
            original_raw,
        )
        retry_messages = list(egress_messages)
        retry_messages.append({
            "role": "user",
            "content": "请只用文字回复，不要调用任何工具。",
        })
        try:
            content = await _complete_text(llm.client, llm.provider.model, retry_messages)
            cleaned = strip_tool_markup(content)
            if not cleaned.strip():
                logger.warning(
                    "continue_after_tool_result: retry also empty, raw=%r — giving up",
                    content[:200],
                )
                cleaned = "操作已完成。如需继续，请告诉我下一步想做什么。"
        except Exception as e:
            logger.exception("continue_after_tool_result retry failed")
            cleaned = f"操作已完成，但无法生成后续回复：{e}"

    if cleaned.strip():
        conversation.save_assistant_message(cleaned)
    return cleaned

async def create_stream(llm, messages: list[dict]):
    """Try primary LLM provider (with retries for transient errors), then fallbacks."""
    from openai import APIConnectionError as _OpenAIConnectionError
    from openai import AsyncOpenAI

    from app.core.agents.llm_failover import LLMProvider

    TRANSIENT_ERRORS = (_OpenAIConnectionError, TimeoutError, asyncio.TimeoutError)
    MAX_PRIMARY_ATTEMPTS = 3

    candidates: list[tuple[AsyncOpenAI, LLMProvider]] = [
        (llm.client, llm.provider),
        *llm_router.get_fallback_clients(),
    ]
    errors: list[str] = []
    llm_start = time.time()
    egress_messages, _egress_audit = audit_llm_egress(messages, purpose="chat_stream")
    for idx, (client, provider) in enumerate(candidates):
        is_primary = idx == 0
        max_attempts = MAX_PRIMARY_ATTEMPTS if is_primary else 1

        for attempt in range(max_attempts):
            try:
                response = await client.chat.completions.create(  # type: ignore[call-overload]
                    model=provider.model,
                    messages=egress_messages,
                    tools=kernel.list_capability_definitions(),
                    tool_choice="auto",
                    temperature=runtime_config.get_generation_params()[0],
                    max_tokens=runtime_config.get_generation_params()[1],
                    stream=True,
                    stream_options={"include_usage": True},
                )
                return response, client, provider
            except TRANSIENT_ERRORS as e:
                if attempt < max_attempts - 1:
                    wait = 1.0 * (2 ** attempt)
                    logger.warning(
                        "Transient error on %s (attempt %d/%d), retrying in %.1fs: %s",
                        provider.name, attempt + 1, max_attempts, wait, e,
                    )
                    await asyncio.sleep(wait)
                    continue
                errors.append(f"{provider.name}({type(e).__name__}: {e})")
                kernel.emit_event(
                    "LLMCallRecorded", "llm_call",
                    f"llm_{time.monotonic_ns()}",
                    payload={
                        "provider": provider.name,
                        "model": provider.model,
                        "latency_ms": round((time.time() - llm_start) * 1000, 2),
                        "success": False,
                        "error_message": str(e),
                    },
                    actor="brain",
                )
                break
            except Exception as e:
                errors.append(f"{provider.name}({type(e).__name__}: {e})")
                kernel.emit_event(
                    "LLMCallRecorded", "llm_call",
                    f"llm_{time.monotonic_ns()}",
                    payload={
                        "provider": provider.name,
                        "model": provider.model,
                        "latency_ms": round((time.time() - llm_start) * 1000, 2),
                        "success": False,
                        "error_message": str(e),
                    },
                    actor="brain",
                )
                break
    if len(candidates) > 1:
        raise RuntimeError(f"All LLM providers failed: {'; '.join(errors)}")
    raise RuntimeError(errors[0]) if errors else RuntimeError("No LLM provider available")

async def synthesize_from_tool_results(llm, messages: list[dict]) -> str:
    """Final text-only pass when the tool loop hits its iteration cap."""
    synth_messages = list(messages)
    synth_messages.append({
        "role": "user",
        "content": (
            "已达到工具调用次数上限。请仅根据上述对话与工具返回的结果，"
            "用中文直接回答用户最初的问题，不要再调用任何工具。"
        ),
    })
    egress_messages, _egress_audit = audit_llm_egress(
        synth_messages, purpose="synthesize_tool_results",
    )
    try:
        content = await _complete_text(llm.client, llm.provider.model, egress_messages)
        return strip_tool_markup(content.strip())
    except Exception:
        logger.exception("synthesize_from_tool_results failed")
        return ""

async def complete_text_only(llm, messages: list[dict], user_message: str) -> str:
    """Retry once without tools when the model returns an empty completion."""
    retry_messages = list(messages)
    retry_messages.append({
        "role": "user",
        "content": (
            f"{user_message}\n\n"
            "(请直接文字回复。)"
        ),
    })
    egress_messages, _egress_audit = audit_llm_egress(
        retry_messages, purpose="complete_text_only",
    )
    try:
        content = await _complete_text(llm.client, llm.provider.model, egress_messages)
        return strip_tool_markup(content.strip())
    except Exception:
        logger.exception("complete_text_only retry failed")
        return "抱歉，我暂时无法生成回复，请再试一次。"


async def complete_text_with_failover(
    messages: list[dict],
    *,
    purpose: str,
    temperature: float | None = None,
    max_tokens: int | None = None,
    actor: str = "api",
) -> tuple[str, str]:
    """Text-only completion routed through primary + fallback providers.

    Centralizes the non-Brain LLM call paths (goal breakdown, inbox classify /
    summary) so they get the same failover + egress audit as the Brain paths.
    Returns ``(content, provider_name)``.

    Raises ``RuntimeError`` when every configured provider fails.
    """
    from openai import AsyncOpenAI

    from app.core.agents.llm_failover import LLMProvider

    try:
        client, provider = llm_router.get_client()
        candidates: list[tuple[AsyncOpenAI, LLMProvider]] = [
            (client, provider),
            *llm_router.get_fallback_clients(),
        ]
    except RuntimeError as exc:
        logger.warning("complete_text_with_failover: no provider configured: %s", exc)
        raise

    if temperature is None or max_tokens is None:
        gen_temp, gen_max = runtime_config.get_generation_params()
        temperature = temperature if temperature is not None else gen_temp
        max_tokens = max_tokens if max_tokens is not None else gen_max

    audited_messages, _audit = audit_llm_egress(
        messages, purpose=purpose, actor=actor,
    )

    errors: list[str] = []
    for client, provider in candidates:
        try:
            content = (await _complete_text(
                client, provider.model, audited_messages,
                temperature=temperature, max_tokens=max_tokens,
            )).strip()
            if content:
                return content, provider.name
            errors.append(f"{provider.name}(empty response)")
        except Exception as exc:
            errors.append(f"{provider.name}({type(exc).__name__}: {exc})")
            logger.warning(
                "complete_text_with_failover provider %s failed: %s",
                provider.name, exc,
            )

    raise RuntimeError(
        f"All LLM providers failed for {purpose}: {'; '.join(errors)}"
    )
