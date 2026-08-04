"""事件总线分发 + submit_command 的 Future 解析。

从 ``kernel.py`` 抽出，让 God Object 的 LOC 预算可以收缩而不扩张
``runtime_files``（与把 ``projectors_timer`` 折进 ``projectors_inbox``
配套）。本模块仍属 Kernel Space。

``submit_command`` 不是新的 Ontology 层——它是包在 ``emit_event`` 外的
同步封装，通过 correlation_id 等待匹配的完成事件。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from .event import Event

logger = logging.getLogger(__name__)

# RuntimeLoop.start() 注册的主 asyncio 循环：从工作线程（该线程无运行中的
# 循环）发出的事件也能送达异步分发器，而不是被静默丢弃。
_dispatch_loop: asyncio.AbstractEventLoop | None = None


def set_dispatch_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """绑定用于调度工作线程分发的主事件循环。

    由 RuntimeLoop.start()/stop() 调用。当事件从没有运行循环的线程发出
    （如记忆索引修复工作线程）时，``dispatch`` 经 ``call_soon_threadsafe``
    把异步分发器调度到本循环，保证实时投递不丢失。
    """
    global _dispatch_loop
    _dispatch_loop = loop


def log_dispatch_task_exception(task: "asyncio.Task") -> None:
    """fire-and-forget 事件分发任务的完成回调。

    缺少它，异步分发器内部的异常只会留在任务的 _exception 属性里而不被
    记录——使生产环境调试几乎不可能。
    """
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error(
            "Event dispatch task failed: %s",
            exc,
            exc_info=exc,
        )


def default_completion_type(event_type: str) -> str:
    """为 submit_command 请求推导完成事件类型。"""
    if event_type.endswith("Requested"):
        return event_type.replace("Requested", "Completed")
    return event_type + "Completed"


def resolve_pending_command(
    kernel: Any,
    *,
    correlation_id: str,
    completion_type: str,
    payload: dict[str, object],
    aggregate_type: str = "command",
    aggregate_id: str = "rejected",
    caused_by: str | None = None,
) -> bool:
    """在不发领域事件的前提下解析等待中的 ``submit_command`` Future。

    Lane A 在背压下拒绝分发时使用，让调用方拿到
    ``{"status": "error", "error": "queue_full"}`` 而不是超时。
    返回 True 表示解析了一个 pending Future。
    """
    if not correlation_id or not completion_type:
        return False
    key = (correlation_id, completion_type)
    with kernel._commands_lock:
        future = kernel._pending_commands.get(key)
    if future is None:
        return False

    from .event import Event

    synthetic = Event(
        type=completion_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload=payload,
        actor="scheduler",
        caused_by=caused_by,
        correlation_id=correlation_id,
    )
    if not _resolve_future_threadsafe(future, synthetic):
        return False
    with kernel._commands_lock:
        kernel._pending_commands.pop(key, None)
    return True


async def submit_command(
    kernel: Any,
    type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: dict[str, object] | None = None,
    actor: str = "system",
    caused_by: str | None = None,
    correlation_id: str | None = None,
    *,
    timeout: float = 60.0,
    completion_type: str | None = None,
) -> dict:
    """发出事件并同步等待完成事件。

    返回完成事件的 payload dict；超时返回
    ``{"error": "timeout", "status": "timeout"}``。
    """
    if correlation_id is None:
        correlation_id = f"cmd_{uuid.uuid4().hex[:12]}"

    if completion_type is None:
        completion_type = default_completion_type(type)

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    key = (correlation_id, completion_type)
    with kernel._commands_lock:
        kernel._pending_commands[key] = future

    try:
        kernel.emit_event(
            type=type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload or {},
            actor=actor,
            caused_by=caused_by,
            correlation_id=correlation_id,
        )

        result = await asyncio.wait_for(future, timeout=timeout)
        return result.payload
    except asyncio.TimeoutError:
        return {"error": "timeout", "status": "timeout"}
    except Exception as exc:
        return {"error": str(exc), "status": "error"}
    finally:
        # 防御性清理：即使分发漏掉了完成事件也保证注册不泄漏。
        # pop(key, None) 在分发已解析并移除 key 时是安全的 no-op。
        with kernel._commands_lock:
            kernel._pending_commands.pop(key, None)


def _resolve_future_threadsafe(
    future: "asyncio.Future",
    event: "Event",
) -> bool:
    """在运行中的循环上调度 ``future.set_result(event)``。

    无循环运行时返回 False（调用方应让 future 自行超时——不要 cancel，
    那会给 wait_for 注入 CancelledError）。
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False

    def _resolve(f: "asyncio.Future", e: "Event") -> None:
        if not f.done():
            f.set_result(e)

    loop.call_soon_threadsafe(_resolve, future, event)
    return True


def dispatch(kernel: Any, event: "Event") -> None:
    """把事件推给同步订阅者、异步分发器与命令 Future。"""
    for flt, handler in list(kernel._subscribers):
        if flt["type"] and flt["type"] != event.type:
            continue
        if flt["aggregate_type"] and flt["aggregate_type"] != event.aggregate_type:
            continue
        try:
            handler(event)
        except Exception as exc:
            logger.warning(
                "Event subscriber failed for %s (aggregate=%s/%s): %s",
                event.type,
                event.aggregate_type,
                event.aggregate_id,
                exc,
                exc_info=True,
            )

    # 触发已注册的异步分发器（Scheduler）。存储已经提交；这是尽力而为的
    # 实时投递。
    async_dispatcher: Callable | None = kernel._async_dispatcher
    if async_dispatcher is not None:
        try:
            loop = asyncio.get_running_loop()
            task = loop.create_task(async_dispatcher(event))
            task.add_done_callback(log_dispatch_task_exception)
            if not hasattr(kernel, "_dispatch_tasks"):
                kernel._dispatch_tasks = set()
            task.add_done_callback(kernel._dispatch_tasks.discard)
            kernel._dispatch_tasks.add(task)
        except RuntimeError:
            # 当前线程无运行循环——如工作线程（记忆索引修复）中 emit_event。
            # 改经主循环投递而不是丢弃事件，让订阅者仍能实时看到。
            main_loop = _dispatch_loop
            if main_loop is not None and main_loop.is_running():
                def _schedule_on_main_loop() -> None:
                    task = main_loop.create_task(async_dispatcher(event))
                    task.add_done_callback(log_dispatch_task_exception)
                    if not hasattr(kernel, "_dispatch_tasks"):
                        kernel._dispatch_tasks = set()
                    task.add_done_callback(kernel._dispatch_tasks.discard)
                    kernel._dispatch_tasks.add(task)

                main_loop.call_soon_threadsafe(_schedule_on_main_loop)
            else:
                logger.debug(
                    "Event dispatch skipped (no running loop) for %s "
                    "aggregate=%s/%s — event is persisted, subscribers "
                    "will see it on next read_events/replay.",
                    event.type,
                    event.aggregate_type,
                    event.aggregate_id,
                )

    # 在匹配的完成事件上解析 pending submit_command Future。
    key = (event.correlation_id or "", event.type)
    with kernel._commands_lock:
        future = kernel._pending_commands.pop(key, None)
    if future is not None and not future.done():
        if not _resolve_future_threadsafe(future, event):
            return
