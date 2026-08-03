"""MCP Client Hub——工具注册、发现与调用的统一入口。

同时支持同步与异步工具 handler。内置工具接线放在
``mcp_builtin_registration``，保持本文件不超 Architecture Contract
对 God Object 的体量约束。
"""

import inspect
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from app.core.runtime.runtime_container import _LazyProxy, runtime

logger = logging.getLogger(__name__)


@dataclass
class ToolDef:
    """供 LLM 调用的工具定义。"""

    name: str
    description: str
    parameters: dict
    handler: Callable[..., str | Awaitable[str]]
    is_async: bool = False
    requires_confirmation: bool = False


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
        from app.core.harness import mcp_builtin_registration as reg
        reg._register_all_tools(self)

    def register_mesh_tools(self, tool_defs: list) -> int:
        """注册 MCP Mesh 发现到的外部工具，返回新增数量。"""
        from app.core.harness import mcp_builtin_registration as reg
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
        """按名调用工具，兼容同步/异步 handler，返回结果字符串。"""
        tool = self._tools.get(name)
        if not tool:
            return json.dumps({"error": f"Unknown tool: {name}"})

        kwargs = _filter_tool_kwargs(tool.handler, arguments)
        try:
            if tool.is_async:
                result = await cast(Awaitable[str], tool.handler(**kwargs))
            else:
                result = cast(str, tool.handler(**kwargs))

            # 超长输出截断到 8000 字符，避免一次工具结果把整个上下文撑爆。
            if isinstance(result, str) and len(result) > 8000:
                result = result[:8000] + "\n... [output truncated]"
            return result
        except TypeError as e:
            logger.warning("Tool %s invalid arguments: %s", name, e)
            return json.dumps({"error": f"Invalid arguments for {name}: {e}"})
        except Exception as e:
            logger.exception("Tool %s failed", name)
            return json.dumps({"error": str(e)})


# 单例——经 RuntimeContainer 惰性代理，runtime.reset() 后重建。
if TYPE_CHECKING:
    mcp_hub: MCPHub
else:
    mcp_hub = _LazyProxy(lambda: runtime.mcp_hub)
