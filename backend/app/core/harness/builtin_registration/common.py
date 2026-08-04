"""内置工具注册的共享原语。

内置工具以声明式 spec 描述（参数 JSON schema + handler），由本模块
统一转换为 MCPHub 的 ToolDef 并注册，避免各工具自行处理注册细节。
"""

from __future__ import annotations

import asyncio
import functools
import inspect
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from app.core.harness.mcp_hub import ToolDef


@dataclass(frozen=True)
class BuiltinToolSpec:
    """内置工具的声明式描述，经 ``_register_specs`` 注册到 hub。"""

    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Any]
    is_async: bool = False
    requires_confirmation: bool = False
    # 同步 handler 用 ``asyncio.to_thread`` 包装（等价 ``is_async=True``）。
    offload: bool = False


def _offload(fn: Callable[..., str]) -> Callable[..., Awaitable[str]]:
    """把同步工具 handler 放进工作线程，避免阻塞事件循环。

    包装器保留 ``fn`` 的 ``__signature__``，使 MCPHub 的 kwargs 过滤仍能
    丢弃 LLM 传入的意外参数。
    """

    @functools.wraps(fn)
    async def _handler(*args: object, **kwargs: object) -> str:
        return await asyncio.to_thread(fn, *args, **kwargs)

    try:
        _handler.__signature__ = inspect.signature(fn)  # type: ignore[attr-defined]
    except (TypeError, ValueError):
        pass
    return _handler


def _register_specs(hub, specs: Sequence[BuiltinToolSpec]) -> None:
    for spec in specs:
        handler: Callable[..., str | Awaitable[str]] = (
            _offload(spec.handler) if spec.offload else spec.handler
        )
        hub.register_tool(ToolDef(
            name=spec.name,
            description=spec.description,
            parameters=spec.parameters,
            handler=handler,
            is_async=spec.is_async or spec.offload,
            requires_confirmation=spec.requires_confirmation,
        ))
