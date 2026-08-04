"""Kernel 单例——User Space 唯一入口。

User-space 代码绝不可直接实例化 Kernel，必须导入本单例。这是「金律」的
强制保证：User Space 永不触碰存储，一切经 kernel 通行。

具体 Kernel 实例挂在 RuntimeContainer 上；此处 ``kernel`` 是惰性代理，
把每次属性访问转发到 ``runtime.kernel``。这样 ``from
app.core.runtime.kernel_instance import kernel`` 保持可用，同时让
``runtime.reset()`` 成为测试隔离的唯一入口。

下方的 Scheduler / execution 助手是薄 ABI 包装，让 API 与 Product 层无需
直接导入深层的 Runtime 模块。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.core.runtime.runtime_container import _LazyProxy, runtime

if TYPE_CHECKING:
    from app.core.runtime.kernel.kernel import Kernel

if TYPE_CHECKING:
    kernel: "Kernel"
else:
    kernel = _LazyProxy(lambda: runtime.kernel)


async def ensure_runtime_scheduler() -> None:
    """按需绑定并启动进程 Scheduler（API/Product ABI）。"""
    from app.core.runtime.agent_scheduler import ensure_scheduler

    await ensure_scheduler(kernel)


def get_runtime_scheduler() -> Any:
    """返回进程 Scheduler 单例（API/Product ABI）。"""
    from app.core.runtime.agent_scheduler import get_scheduler

    return get_scheduler(kernel)


def get_current_execution_id() -> str | None:
    """当前 Execution 上下文 id（若有）（Product ABI）。"""
    from app.core.runtime.execution import get_current_execution_id as _get

    return _get()


def bind_inbox_poll_applier(fn) -> None:
    """在 RuntimeContainer 上注册 Product 收件箱轮询应用器（ABI）。"""
    from app.core.runtime.runtime_container import runtime

    runtime.bind_inbox_poll_applier(fn)
