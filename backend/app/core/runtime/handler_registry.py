"""HandlerRegistry——把事件类型映射到业务逻辑 handler（Lane A）。

扇出：一个事件类型可注册 N 个 handler。Scheduler 为每个 handler 创建一条
ScheduledExecution。handler 永远不会被静默覆盖。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Awaitable, Callable

if TYPE_CHECKING:
    from .execution import ExecutionContext
    from .kernel.event import Event

logger = logging.getLogger(__name__)

Handler = Callable[["ExecutionContext", "Event"], Awaitable[None]]

_registry: dict[str, list[Handler]] = {}


def subscribe(*event_types: str):
    """装饰器：为一个或多个事件类型追加 handler（扇出）。"""

    def deco(fn: Handler) -> Handler:
        for et in event_types:
            bucket = _registry.setdefault(et, [])
            if any(h is fn or h.__name__ == fn.__name__ for h in bucket):
                logger.warning(
                    "HandlerRegistry: %s already listed for %s; skipping duplicate.",
                    fn.__name__,
                    et,
                )
                continue
            bucket.append(fn)
        return fn

    return deco


def get_handlers(event_type: str) -> list[Handler]:
    """返回某事件类型注册的全部 handler（可能为空）。"""
    return list(_registry.get(event_type, []))


def get_handler_named(event_type: str, handler_name: str) -> Handler | None:
    """为一条 ScheduledExecution 按函数名解析具体 handler。"""
    for handler in get_handlers(event_type):
        if handler.__name__ == handler_name:
            return handler
    return None


def registered_types() -> list[str]:
    """返回全部已注册事件类型（调试 / 内省用）。"""
    return sorted(_registry.keys())


def reset_handlers() -> None:
    """清空全部已注册 handler——测试隔离用。"""
    _registry.clear()
