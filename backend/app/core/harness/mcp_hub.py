"""MCP Client Hub——工具注册、发现与调用的统一入口。

同时支持同步与异步工具 handler。内置工具接线放在
``builtin_registration``，保持本文件不超 Architecture Contract
对 God Object 的体量约束。
"""

import asyncio
import inspect
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from app.core.runtime.runtime_container import _LazyProxy, runtime

logger = logging.getLogger(__name__)

# Outcomes Kernel maps onto invoke_capability / CapabilityFailed.
OUTCOME_TOOL_NOT_FOUND = "tool_not_found"
OUTCOME_TOOL_TIMEOUT = "tool_timeout"
OUTCOME_TOOL_EXECUTION_FAILURE = "tool_execution_failure"
OUTCOME_TOOL_INVALID_RESULT = "tool_invalid_result"
OUTCOME_AUTHORIZATION_FAILURE = "authorization_failure"


class ToolInvokeError(Exception):
    """Handler failed. Kernel must emit CapabilityFailed, not CapabilityInvoked."""

    def __init__(self, reason: str, message: str, *, tool_name: str = ""):
        self.reason = reason
        self.tool_name = tool_name
        super().__init__(message)


@dataclass
class ToolDef:
    """供 LLM 调用的工具定义。"""

    name: str
    description: str
    parameters: dict
    handler: Callable[..., str | Awaitable[str]]
    is_async: bool = False
    requires_confirmation: bool = False


# Plain-text tool output is clipped so a single call cannot blow LLM context.
# Structured JSON must stay parseable: Kernel consumers (inbox poll, mark-read)
# json.loads the full result. LLM-facing compaction lives in tool_postprocess.
TOOL_RESULT_CHAR_LIMIT = 8000
JSON_RESULT_CHAR_LIMIT = 256_000


def _clip_tool_result(result: str) -> str:
    """Clip oversized tool output without turning JSON into a parse error."""
    if len(result) <= TOOL_RESULT_CHAR_LIMIT:
        return result
    stripped = result.lstrip()
    if stripped[:1] in "{[":
        try:
            json.loads(result)
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
        else:
            if len(result) <= JSON_RESULT_CHAR_LIMIT:
                return result
            logger.warning(
                "JSON tool result exceeds %s chars; replacing with error payload",
                JSON_RESULT_CHAR_LIMIT,
            )
            return json.dumps({"error": "result_too_large", "truncated": True})
    return result[:TOOL_RESULT_CHAR_LIMIT] + "\n... [output truncated]"


def _filter_tool_kwargs(handler: Callable[..., Any], arguments: dict) -> dict:
    """当 handler 是固定签名时，丢弃 LLM 传入的意外参数。

    接受 ``**kwargs`` 的 handler（如 mesh 代理）保留全部参数；否则只保留
    与签名参数名匹配的 key，避免把模型幻觉出的字段透传给底层工具。
    """
    try:
        sig = inspect.signature(handler)
    except (TypeError, ValueError):
        return arguments
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return arguments
    allowed = {
        name
        for name, p in sig.parameters.items()
        if p.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        )
    }
    return {k: v for k, v in arguments.items() if k in allowed}


class MCPHub:
    """工具中枢：注册、查询并转发 LLM 的工具调用。"""

    # 默认启用的核心类目——每个对话回合都会暴露给模型。刻意保持精简：
    # 减少提示词 token 占用，也压缩暴露给模型的写类工具攻击面。
    CORE_CATEGORIES: frozenset[str] = frozenset({
        "time", "filesystem", "web", "calendar", "email",
        "shell", "git", "goals",
    })
    # 依赖宿主 GUI/消息/硬件的高级类目，需经 settings.builtin_tool_categories
    # 显式开启。浏览器自动化归外部 Playwright MCP 管，不在内置之列。
    ADVANCED_CATEGORIES: frozenset[str] = frozenset({
        "telegram", "computer_use", "voice", "clipboard_ocr",
    })

    def __init__(self, enabled_categories: set[str] | None = None):
        self._tools: dict[str, ToolDef] = {}
        if enabled_categories is None:
            try:
                from app.config import settings
                raw = settings.builtin_tool_categories.strip()
            except Exception:
                raw = ""
            # 选择加入的类目是*叠加*在 CORE 之上——只写 ``telegram``
            # 不应把 filesystem/shell 等核心类目挤掉。
            opt_in = {c.strip() for c in raw.split(",") if c.strip()} if raw else set()
            enabled_categories = set(self.CORE_CATEGORIES) | opt_in
        self._enabled_categories = enabled_categories
        self._register_all_tools()

    def _register_all_tools(self) -> None:
        from app.core.harness import builtin_registration as reg
        reg._register_all_tools(self)

    def register_mesh_tools(self, tool_defs: list) -> int:
        """注册 MCP Mesh 发现到的外部工具，返回新增数量。"""
        from app.core.harness import builtin_registration as reg
        return reg.register_mesh_tools(self, tool_defs)

    def register_tool(self, tool: ToolDef):
        self._tools[tool.name] = tool

    def unregister_tool(self, name: str) -> None:
        self._tools.pop(name, None)

    def get_tool_defs_for_llm(self) -> list[dict]:
        """返回暴露给模型看的 OpenAI 风格工具 schema。

        被禁止的能力在此被滤掉，既不消耗 prompt token，也不作为可调用选项
        出现在模型面前。
        """
        from app.core.runtime.capability_governance import capability_governance

        defs: list[dict] = []
        for t in self._tools.values():
            if capability_governance.is_forbidden(t.name):
                continue
            defs.append({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            })
        return defs

    def get_tool(self, name: str) -> ToolDef | None:
        return self._tools.get(name)

    def needs_confirmation(self, name: str) -> bool:
        tool = self._tools.get(name)
        return tool.requires_confirmation if tool else False

    def is_async(self, name: str) -> bool:
        tool = self._tools.get(name)
        return tool.is_async if tool else False

    async def invoke_tool(self, name: str, arguments: dict) -> str:
        """按名调用工具。失败抛 ``ToolInvokeError``，不把异常吞成 JSON success。"""
        tool = self._tools.get(name)
        if not tool:
            raise ToolInvokeError(
                OUTCOME_TOOL_NOT_FOUND,
                f"Unknown tool: {name}",
                tool_name=name,
            )

        kwargs = _filter_tool_kwargs(tool.handler, arguments)
        try:
            from app.config import settings
            timeout = float(settings.tool_timeout_seconds or 30)
        except Exception:
            timeout = 30.0

        try:
            if tool.is_async:
                result = await asyncio.wait_for(
                    cast(Awaitable[str], tool.handler(**kwargs)),
                    timeout=timeout,
                )
            else:
                result = cast(str, tool.handler(**kwargs))

            if not isinstance(result, str):
                result = str(result)
            return _clip_tool_result(result)
        except ToolInvokeError:
            raise
        except TimeoutError:
            logger.warning("Tool %s timed out after %ss", name, timeout)
            raise ToolInvokeError(
                OUTCOME_TOOL_TIMEOUT,
                f"Tool {name} timed out after {timeout}s",
                tool_name=name,
            ) from None
        except TypeError as e:
            logger.warning("Tool %s invalid arguments: %s", name, e)
            raise ToolInvokeError(
                OUTCOME_TOOL_INVALID_RESULT,
                f"Invalid arguments for {name}: {e}",
                tool_name=name,
            ) from e
        except Exception as e:
            logger.exception("Tool %s failed", name)
            raise ToolInvokeError(
                OUTCOME_TOOL_EXECUTION_FAILURE,
                str(e),
                tool_name=name,
            ) from e


# 单例——经 RuntimeContainer 惰性代理，runtime.reset() 后重建。
if TYPE_CHECKING:
    mcp_hub: MCPHub
else:
    mcp_hub = _LazyProxy(lambda: runtime.mcp_hub)
