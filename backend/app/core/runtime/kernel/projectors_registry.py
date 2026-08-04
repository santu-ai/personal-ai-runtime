"""投影器——把不可变事件日志变成可变 State（物化视图）。

按 docs/01-overview/architecture.md：State 是事件的*投影*，绝不直接写。投影器消费
事件并物化读模型（这里是 ``goals`` 等表）。因为投影完全派生，随时可以
清空并由事件日志重放重建——这是本片要证明的核心性质。
"""

from __future__ import annotations

from typing import Callable

from .event import Event

# 投影器 handler 把单个事件应用到投影，使用 Kernel 提供的打开的 sqlite
# 连接（存储访问归 Kernel Space 所有）。
Handler = Callable[[Event, "object"], None]

_HANDLERS: dict[str, Handler] = {}
# aggregate_type -> 该投影器拥有的投影表（供 rebuild 使用）。
_OWNED_TABLES: dict[str, list[str]] = {}


def projector(*event_types: str):
    """为一个或多个事件类型注册 handler。"""

    def deco(fn: Handler) -> Handler:
        for et in event_types:
            _HANDLERS[et] = fn
        return fn

    return deco


def apply(event: Event, conn) -> None:
    """把事件应用到其投影（若有注册的投影器）。"""
    handler = _HANDLERS.get(event.type)
    if handler is not None:
        handler(event, conn)


def owned_tables(aggregate_type: str) -> list[str]:
    return _OWNED_TABLES.get(aggregate_type, [])


# 副作用导入：各 projectors_* 模块经 @projector 注册 handler。
# 放在这里（而非独立 projectors.py），使抽出其他 Kernel 协作方时
# runtime_files 保持零和。
from . import (  # noqa: E402, F401
    projectors_chat,
    projectors_core,
    projectors_execution,
    projectors_governance,
    projectors_inbox,
)

