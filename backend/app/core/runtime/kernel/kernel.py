"""Kernel——Personal AI Runtime 的边界（Kernel Space）。

这里独占存储访问。User Space（agents、workflows、APIs、UI）只能经由本
ABI，绝不直接读写数据库。

实现 docs/01-overview/architecture.md 中的核心 P0 ABI：
    emit_event / read_events / subscribe_events / query_state

模块划分：
- 治理 → governance_ops.py（Kernel 上的方法）
- 查询态（选择器路由）→ kernel_query_state.py；SQL → query_builder.py
- 数据主权 → kernel_sovereignty.py → sovereignty_ops.py；记忆同步 →
  memory_index_sync.py
- 事件总线（_dispatch / submit_command）→ event_dispatch.py
"""

from __future__ import annotations

import json
import threading
from typing import TYPE_CHECKING, Any, Callable

from . import event_dispatch
from . import governance_ops as _gov_ops
from . import projectors_registry as projectors
from .event import Event
from .kernel_query_state import QueryStateMixin
from .kernel_sovereignty import SovereigntyMixin
from .memory_index_sync import (  # noqa: F401 — 供测试 / RuntimeContainer 再导出
    clear_pending_memory_index_repairs,
    drain_memory_index_repairs,
    get_pending_memory_index_repairs,
    sync_memory_index,
)

if TYPE_CHECKING:
    import asyncio

Subscriber = Callable[[Event], None]

DEFAULT_APPROVAL_TTL_SECONDS = _gov_ops.DEFAULT_APPROVAL_TTL_SECONDS


class Kernel(QueryStateMixin, SovereigntyMixin):
    def __init__(self, db=None, *, memory_index=None):
        # 默认使用全局 Database 单例；测试注入自己的 db。
        if db is None:
            from app.store.database import db as global_db

            db = global_db
        self._db = db
        self._memory_index = memory_index  # MemoryIndexPort | None
        self._subscribers: list[tuple[dict, Subscriber]] = []
        self._async_dispatcher: Callable | None = None
        self._pending_commands: dict[tuple[str, str], "asyncio.Future"] = {}
        self._commands_lock = threading.Lock()
        self._ensure_schema()

    # -- 任务与代理生命周期 ---------------------------------------------------

    def _ensure_schema(self) -> None:
        """执行 Alembic 迁移；测试/自定义库回退到裸 DDL。"""
        from app.store.schema_init import ensure_schema
        ensure_schema(self._db)

    # --- 真相层 -------------------------------------------------------------

    def emit_event(
        self,
        type: str,
        aggregate_type: str,
        aggregate_id: str,
        payload: dict[str, object] | None = None,
        actor: str = "system",
        caused_by: str | None = None,
        correlation_id: str | None = None,
    ) -> Event:
        """追加一条不可变事件，投影到 State，再通知订阅者。

        这是 Runtime 唯一的写入入口。系统内一切状态变更都流经此处，
        因此事件日志是权威真相。
        """
        event = Event.create(
            type=type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            actor=actor,
            caused_by=caused_by,
            correlation_id=correlation_id,
        )

        # 向量索引同步放在提交后（_sync_memory_index）完成。早期实现把嵌入
        # 预计算放在这里、让投影器在同一事务写 embedding_id，但会引入非对称
        # 失败：嵌入成功而 SQLite INSERT 失败（回滚）时，ChromaDB 会遗留孤立
        # 向量。提交后再同步是最终一致（embedding_id 初始为 NULL，经
        # MemoryUpdated 或持久化修复队列回填），但因为事件先已落盘，永不产生
        # 孤立向量。

        with self._db.get_db() as conn:
            cur = conn.execute(
                """INSERT INTO event_log
                   (id, type, aggregate_type, aggregate_id, actor, payload,
                    caused_by, correlation_id, ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    event.id,
                    event.type,
                    event.aggregate_type,
                    event.aggregate_id,
                    event.actor,
                    json.dumps(event.payload),
                    event.caused_by,
                    event.correlation_id,
                    event.ts,
                ),
            )
            seq = int(cur.lastrowid)
            # 在同一事务内同步投影，保证 State 与产生它的事件一致。
            event = event.with_seq(seq)
            projectors.apply(event, conn)

        self._sync_memory_index(event)
        self._dispatch(event)
        self._notify_goal_changed(event)
        return event

    async def submit_command(
        self,
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
        """Emit an event and wait for a completion event (see event_dispatch)."""
        return await event_dispatch.submit_command(
            self,
            type,
            aggregate_type,
            aggregate_id,
            payload=payload,
            actor=actor,
            caused_by=caused_by,
            correlation_id=correlation_id,
            timeout=timeout,
            completion_type=completion_type,
        )


    def _sync_memory_index(self, event: Event) -> None:
        """提交后的 MemoryIndexPort 同步（见 memory_index_sync）。"""
        sync_memory_index(self, event)

    def drain_memory_index_repairs(self) -> None:
        """重试 durable memory_index_repairs 行（Kernel Space ABI）。"""
        drain_memory_index_repairs(self)

    def _notify_memory_changed(self, event: Event, content: str) -> None:
        """推送轻量 WS 事件，让前端可失效缓存。

        纯传输——不落通知行（MemoryDerived/Updated 事件才是权威记录）。
        这里的失败绝不能影响存储；在 ``broadcast_event`` 内以 DEBUG 级吞掉。
        """
        from app.core.runtime.notification_bridge import broadcast_event

        broadcast_event({
            "type": "memory_changed",
            "event_type": event.type,
            "memory_id": event.aggregate_id,
            "category": event.payload.get("category", "general"),
            "preview": (content or "")[:120],
            "ts": event.ts,
        })

    _GOAL_NOTIFY_TYPES = frozenset({
        "WorkItemCreated",
        "WorkItemUpdated",
        "WorkItemStatusChanged",
        "WorkItemDeleted",
    })

    def _notify_goal_changed(self, event: Event) -> None:
        """work_items（目标/行动）变化时推送 WS 提示。"""
        if event.type not in self._GOAL_NOTIFY_TYPES:
            return
        if event.aggregate_type != "work_item":
            return
        from app.core.runtime.notification_bridge import broadcast_event

        broadcast_event({
            "type": "goal_changed",
            "event_type": event.type,
            "work_item_id": event.aggregate_id,
            "work_type": event.payload.get("work_type"),
            "ts": event.ts,
        })

    def read_events(
        self,
        aggregate_type: str | None = None,
        aggregate_id: str | None = None,
        aggregate_ids: list[str] | None = None,
        type: str | None = None,
        types: list[str] | None = None,
        correlation_id: str | None = None,
        since_seq: int = 0,
        since_ts: str | None = None,
        until_ts: str | None = None,
        payload_goal_id: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
        order: str = "asc",
        id: str | None = None,
    ) -> list[Event]:
        """读取日志（pull）——重放、投影、审计的基础。"""
        from .query_builder import fetch_event_log_rows

        rows = fetch_event_log_rows(
            self._db,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            aggregate_ids=aggregate_ids,
            type=type,
            types=types,
            correlation_id=correlation_id,
            since_seq=since_seq,
            since_ts=since_ts,
            until_ts=until_ts,
            payload_goal_id=payload_goal_id,
            limit=limit,
            offset=offset,
            order=order,
            id=id,
        )
        return [Event.from_row(r) for r in rows]


    def read_events_by_seqs(self, seqs: list[int]) -> list[Event]:
        """按全局日志序列号批量读取（kernel-space 批量读）。"""
        if not seqs:
            return []
        unique = sorted({int(s) for s in seqs})
        placeholders = ",".join("?" * len(unique))
        with self._db.get_db() as conn:
            rows = conn.execute(
                f"SELECT * FROM event_log WHERE seq IN ({placeholders}) ORDER BY seq ASC",
                unique,
            ).fetchall()
        return [Event.from_row(r) for r in rows]

    def subscribe_events(
        self,
        handler: Subscriber,
        type: str | None = None,
        aggregate_type: str | None = None,
    ) -> Callable[[], None]:
        """订阅事件流（push）——把事件日志变成运行时事件总线。返回取消订阅函数。"""
        flt = {"type": type, "aggregate_type": aggregate_type}
        entry = (flt, handler)
        self._subscribers.append(entry)

        def unsubscribe() -> None:
            if entry in self._subscribers:
                self._subscribers.remove(entry)

        return unsubscribe

    def set_async_dispatcher(self, dispatcher: Callable) -> None:
        """设置对 kernel 每个事件的 fire-and-forget 异步分发器。

        取代旧的多分发器列表——始终只有一位消费者注册（Scheduler 经
        ``agent_scheduler.ensure_scheduler``）。再次调用会覆盖前一个分发器
        （set 语义）。

        这是对旧 AgentBus 机制的替代：持久化 Scheduler 在这里注册其分发
        handler，_dispatch() 对每个事件调用它，使 Scheduler 能把事件路由给
        已注册的 @subscribe handler。
        """
        self._async_dispatcher = dispatcher

    def _dispatch(self, event: Event) -> None:
        """推送给订阅者 / 异步分发器 / 命令 Future。"""
        event_dispatch.dispatch(self, event)

    # --- 读层（投影） -------------------------------------------------------
    # 见 kernel_query_state.py（QueryStateMixin）：
    #   query_state() / list_capability_definitions() / recall_memory()

    # --- 治理层 -------------------------------------------------------------

    # --- ScheduledExecution 持久化（Lane A） --------------------------------
    # 读路径在 execution_repository.py（Kernel Space）。
    # 写入仅经 Execution* 投影器。

    def read_scheduled_execution(self, execution_id: str):
        """按 id O(1) 读取一条 ScheduledExecution（Lane A 投影）。"""
        from . import execution_repository
        return execution_repository.read_scheduled_execution(self._db, execution_id)

    def read_scheduled_executions(
        self,
        status: str | None = None,
        instance_id: str | None = None,
    ) -> list:
        """从 handler_executions 读取 ScheduledExecutions（Scheduler 恢复）。

        单行查询优先用 ``read_scheduled_execution(id)``。
        """
        from . import execution_repository
        return execution_repository.read_scheduled_executions(
            self._db, status, instance_id,
        )

    def recover_scheduled_executions(self) -> tuple[list, list]:
        """扫描需要恢复的 ScheduledExecutions（纯读，不写）。"""
        from . import execution_repository
        return execution_repository.recover_scheduled_executions(self._db)

    def count_scheduled_executions_by_status(self) -> dict[str, int]:
        """返回 ``{status: count}``，不加载执行行。"""
        from . import execution_repository
        return execution_repository.count_scheduled_executions_by_status(self._db)

    # --- 治理（ex-GovernanceMixin / governance_ops） -------------------------

    def request_approval(self, action: str, risk: str = 'low', ctx: dict[str, Any] | None = None, actor: str = 'system', correlation_id: str | None = None, expires_in_seconds: int = DEFAULT_APPROVAL_TTL_SECONDS) -> dict:
        """为能力调用请求审批。"""
        return _gov_ops.request_approval(self, action, risk, ctx, actor, correlation_id, expires_in_seconds)

    def expire_stale_approvals(self) -> int:
        """过期所有 expires_at 已到的 pending 审批。"""
        return _gov_ops.expire_stale_approvals(self)

    def grant_approval(self, approval_id: str, action: str = '', actor: str = 'user', reason: str = '', correlation_id: str | None = None) -> None:
        """在受治理的审批投影上记录一次批准。"""
        return _gov_ops.grant_approval(self, approval_id, action, actor, reason, correlation_id)

    def deny_approval(self, approval_id: str, action: str = '', actor: str = 'user', reason: str = '', correlation_id: str | None = None) -> None:
        """在受治理的审批投影上记录一次拒绝。"""
        return _gov_ops.deny_approval(self, approval_id, action, actor, reason, correlation_id)

    def _notify_approval_changed(self, approval_id: str, *, status: str, action: str, event_type: str) -> None:
        """推送轻量 WS 提示，让 Approvals / Trust 缓存刷新。"""
        return _gov_ops._notify_approval_changed(self, approval_id, status=status, action=action, event_type=event_type)

    def _handler_execution_exists(self, execution_id: str) -> bool:
        return _gov_ops._handler_execution_exists(self, execution_id)

    async def invoke_capability(self, name: str, args: dict[str, Any] | None = None, actor: str = 'system', correlation_id: str | None = None, caused_by: str | None = None, pre_approved: bool = False, approval_id: str | None = None, principal: Any | None = None, execution_id: str | None = None) -> dict:
        """经 Kernel 调用能力，带审批门控。"""
        return await _gov_ops.invoke_capability(self, name, args, actor, correlation_id, caused_by, pre_approved, approval_id, principal, execution_id)

    # --- 数据主权（导出 / 导入 / 重建） -------------------------------------

    # 见 kernel_sovereignty.py：
    #   export_event_log_rows() / import_event_log_rows() / table_counts()
    #   export_chat_rows()
    #   rebuild() / rebuild_all()
    #   save_projection_snapshot() / save_projection_snapshots()
    #   _drop_event_log_guards() / _ensure_event_log_guards()
    #   _restore_table_snapshot()
