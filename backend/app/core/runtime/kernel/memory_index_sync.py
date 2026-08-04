"""提交后的记忆向量索引同步 + 持久化修复队列。

从 ``kernel.py`` 抽出，让 God Object 的 LOC 预算可以收缩而不扩张
``runtime_files``（与把 ``projectors.py`` 折进注册表配套）。本模块仍属
Kernel Space。
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from typing import TYPE_CHECKING, Any, Protocol

from .constants import MEMORY_INDEX_EVENT_TYPES

if TYPE_CHECKING:
    from .event import Event

logger = logging.getLogger(__name__)

MEMORY_INDEX_RECONCILE_EVENT = "MemoryIndexReconcile"
MEMORY_INDEX_RECONCILE_AGGREGATE = "__full_reconcile__"
# 串行化 restore/reconcile、常规提交后记忆同步与修复排空，防止旧的修复
# 覆盖新恢复的向量状态。
memory_index_operation_lock = threading.RLock()

# Chroma 索引同步失败的记忆事件进程内队列。
# 作为持久化 ``memory_index_repairs`` 表的内存镜像，用于廉价的可观测性。
# 权威修复队列在 SQLite 中，由 RuntimeLoop._maintenance 排空；此 deque
# 只保留最近失败（maxlen），让仪表盘无需查库即可呈现。
_MAX_PENDING_MEMORY_INDEX_REPAIRS = 1000
_pending_memory_index_repairs: deque[dict[str, object]] = deque(
    maxlen=_MAX_PENDING_MEMORY_INDEX_REPAIRS
)


def get_pending_memory_index_repairs() -> list[dict[str, object]]:
    """返回等待 Chroma 对账的记忆索引事件快照。"""
    return list(_pending_memory_index_repairs)


def clear_pending_memory_index_repairs() -> int:
    """清空进程内修复队列，返回移除条数。

    注意：只清内存镜像。``memory_index_repairs`` 中的持久化行在进程重启
    后仍存在，由 RuntimeLoop 修复工作线程排空。需要干净起点的测试还应
    截断该表。
    """
    count = len(_pending_memory_index_repairs)
    _pending_memory_index_repairs.clear()
    return count


def persist_memory_index_repair(
    db: Any,
    aggregate_id: str,
    event_type: str,
    event_seq: int,
    error: str,
) -> None:
    """把一次失败的记忆索引同步追加进持久化修复队列。

    在 (aggregate_id, event_seq) 上幂等：同一事件已有行则不动它，让重试
    计数与状态反映最初的失败，而不是每次 emit 都被重置。
    """
    from datetime import UTC, datetime

    now_iso = datetime.now(UTC).isoformat()
    try:
        with db.get_db() as conn:
            existing = conn.execute(
                "SELECT 1 FROM memory_index_repairs "
                "WHERE aggregate_id = ? AND event_seq = ? LIMIT 1",
                (aggregate_id, event_seq),
            ).fetchone()
            if existing:
                return
            conn.execute(
                "INSERT INTO memory_index_repairs "
                "(aggregate_id, event_type, event_seq, error, status, created_at) "
                "VALUES (?, ?, ?, ?, 'pending', ?)",
                (aggregate_id, event_type, event_seq, error[:500], now_iso),
            )
    except Exception:
        # 迁移前表尚不存在时无法持久化；退回仅内存，保证 emit_event 不被阻塞。
        logger.debug(
            "Could not persist memory index repair for %s — table unavailable",
            aggregate_id,
            exc_info=True,
        )


def sync_memory_index(kernel: Any, event: "Event") -> None:
    """同步单个事件，排除 restore 与 repair 操作。"""
    with memory_index_operation_lock:
        _sync_memory_index_locked(kernel, event)


def _sync_memory_index_locked(kernel: Any, event: "Event") -> None:
    """把记忆事件同步到 MemoryIndexPort（若配置了）。

    提交后的向量索引同步。在 emit_event 已把事件 + 投影以单个 SQLite
    事务持久化之后调用。因为事件已经落盘，这里的 ChromaDB 失败永远不
    会让事件成为孤儿——只会让 embedding_id 保持 NULL，直到修复队列重试。
    """
    if event.type not in MEMORY_INDEX_EVENT_TYPES:
        return
    content = str(event.payload.get("content", ""))
    try:
        if kernel._memory_index is not None:
            if event.type == "MemoryDeleted":
                kernel._memory_index.delete_memory(event.aggregate_id)
            elif not event.payload.get("embedding_id") and content:
                embedding_id = kernel._memory_index.index_memory(
                    content=content,
                    metadata={
                        "category": str(event.payload.get("category", "general")),
                        "source": str(event.payload.get("source", "")),
                    },
                    memory_id=event.aggregate_id,
                )
                try:
                    kernel.emit_event(
                        "MemoryUpdated", "memory", event.aggregate_id,
                        payload={"embedding_id": embedding_id},
                        actor="kernel",
                    )
                except Exception:
                    logger.debug(
                        "Backfill embedding_id failed for %s",
                        event.aggregate_id,
                        exc_info=True,
                    )
    except Exception as exc:
        # 补偿删除：若 index_memory 中途失败，尝试清除部分 ChromaDB 状态，
        # 让修复重试从干净状态开始。
        if event.type != "MemoryDeleted" and kernel._memory_index is not None:
            try:
                kernel._memory_index.delete_memory(event.aggregate_id)
            except Exception:
                logger.debug(
                    "Compensating delete failed for %s",
                    event.aggregate_id,
                    exc_info=True,
                )
        _pending_memory_index_repairs.append({
            "aggregate_id": event.aggregate_id,
            "event_type": event.type,
            "seq": event.seq,
            "error": str(exc),
        })
        persist_memory_index_repair(
            kernel._db, event.aggregate_id, event.type,
            event.seq or 0, str(exc),
        )
        logger.warning(
            "Memory index sync failed for %s (%s) — queued for repair "
            "(in-memory mirror: %d entries). The durable row will be "
            "drained by RuntimeLoop; check 'memory_index_repairs' table "
            "if recovery does not happen.",
            event.aggregate_id, event.type, len(_pending_memory_index_repairs),
            exc_info=True,
        )
    kernel._notify_memory_changed(event, content if content else "")


def drain_memory_index_repairs(kernel: Any) -> None:
    """重试 pending 的 memory_index_repairs 行（Kernel Space；持锁）。"""
    with memory_index_operation_lock:
        _drain_memory_index_repairs_locked(kernel)


def _drain_memory_index_repairs_locked(kernel: Any) -> None:
    """重试此前失败的 ChromaDB 索引同步。

    拉取有界批次 pending 行，逐条重试；成功删行，失败则 bump retry_count。
    超过重试预算的行标记为 ``failed_permanent`` 并发出
    ``MemoryIndexRepairFailed``。
    """
    from datetime import UTC, datetime

    from .constants import (
        EVENT_MEMORY_INDEX_REPAIR_FAILED,
        EVENT_MEMORY_UPDATED,
    )

    if kernel._memory_index is None:
        return

    max_retries = 5
    batch_size = 10
    now_iso = datetime.now(UTC).isoformat()
    db = kernel._db

    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, aggregate_id, event_type, event_seq, retry_count "
            "FROM memory_index_repairs "
            "WHERE status = 'pending' AND retry_count < ? "
            "ORDER BY id ASC LIMIT ?",
            (max_retries, batch_size),
        ).fetchall()

    for row in rows:
        repair_id = row["id"]
        aggregate_id = row["aggregate_id"]
        event_type = row["event_type"]

        try:
            if event_type == MEMORY_INDEX_RECONCILE_EVENT:
                from .sovereignty_ops import _reconcile_memory_index_after_restore

                if not _reconcile_memory_index_after_restore(kernel):
                    raise RuntimeError("full memory-index reconcile is still unavailable")
            elif event_type == "MemoryDeleted":
                kernel._memory_index.delete_memory(aggregate_id)
            else:
                mems = kernel.query_state("memories", id=aggregate_id, limit=1)
                mem = mems[0] if mems else None
                if not mem:
                    with db.get_db() as conn:
                        conn.execute(
                            "DELETE FROM memory_index_repairs WHERE id = ?",
                            (repair_id,),
                        )
                    continue
                content = str(mem.get("content", ""))
                if not content:
                    try:
                        kernel._memory_index.delete_memory(aggregate_id)
                    except Exception:
                        logger.debug(
                            "Empty-memory vector delete failed for %s",
                            aggregate_id,
                            exc_info=True,
                        )
                    with db.get_db() as conn:
                        conn.execute(
                            "DELETE FROM memory_index_repairs WHERE id = ?",
                            (repair_id,),
                        )
                    continue
                embedding_id = kernel._memory_index.index_memory(
                    content=content,
                    metadata={
                        "category": str(mem.get("category", "general")),
                        "source": str(mem.get("source", "")),
                    },
                    memory_id=aggregate_id,
                )
                if not mem.get("embedding_id") and embedding_id:
                    kernel.emit_event(
                        EVENT_MEMORY_UPDATED, "memory", aggregate_id,
                        payload={"embedding_id": embedding_id},
                        actor="kernel",
                    )
            with db.get_db() as conn:
                conn.execute(
                    "DELETE FROM memory_index_repairs WHERE id = ?",
                    (repair_id,),
                )
            logger.info(
                "Memory index repair succeeded for %s (event_seq=%s)",
                aggregate_id, row["event_seq"],
            )
        except Exception as exc:
            new_count = row["retry_count"] + 1
            if new_count >= max_retries:
                with db.get_db() as conn:
                    conn.execute(
                        "UPDATE memory_index_repairs "
                        "SET retry_count = ?, status = 'failed_permanent', "
                        "    last_retry_at = ?, error = ? "
                        "WHERE id = ?",
                        (new_count, now_iso, str(exc)[:500], repair_id),
                    )
                kernel.emit_event(
                    EVENT_MEMORY_INDEX_REPAIR_FAILED, "memory", aggregate_id,
                    payload={
                        "aggregate_id": aggregate_id,
                        "event_seq": row["event_seq"],
                        "retry_count": new_count,
                        "error": str(exc)[:500],
                    },
                    actor="kernel",
                )
                logger.error(
                    "Memory index repair permanently failed for %s after "
                    "%d attempts — memory will not be recallable until "
                    "verify_vector_consistency.py reconciles it",
                    aggregate_id, new_count,
                    exc_info=True,
                )
            else:
                with db.get_db() as conn:
                    conn.execute(
                        "UPDATE memory_index_repairs "
                        "SET retry_count = ?, last_retry_at = ?, error = ? "
                        "WHERE id = ?",
                        (new_count, now_iso, str(exc)[:500], repair_id),
                    )
                logger.warning(
                    "Memory index repair retry %d/%d for %s: %s",
                    new_count, max_retries, aggregate_id, exc,
                )


# ── MemoryIndexPort 协议（从 runtime/ports.py 迁移而来）──────────────────


class MemoryIndexPort(Protocol):
    """语义记忆索引：存储与召回。

    Kernel 用它与向量索引同步记忆事件，并服务 ``recall_memory``。
    若注入 None，索引同步与召回都是 no-op。
    """

    def index_memory(
        self, content: str, metadata: dict | None = None, memory_id: str | None = None
    ) -> str:
        """索引内容并返回 embedding_id。按 memory_id 幂等。"""
        ...

    def delete_memory(self, memory_id: str) -> None:
        """从向量索引移除一条记忆。"""
        ...

    def list_memory_ids(self) -> list[str]:
        """返回向量索引中当前的全部记忆 ID。"""
        ...

    def search_memories(self, query: str, n_results: int = 5) -> list[dict]:
        """对派生记忆做语义搜索。"""
        ...

    def search_memories_batch(
        self, queries: list[str], n_results: int = 5
    ) -> list[list[dict]]:
        """批量语义搜索；每个 query 返回一个命中列表。"""
        ...
