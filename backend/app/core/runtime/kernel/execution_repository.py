"""ScheduledExecution 持久化读取器——handler_executions 的 Kernel 空间扫描器。

对投影的读路径；写入只经 Execution 投影器响应 Execution* 事件发生。
Scheduler 用这些扫描器在重启后恢复中断的 ScheduledExecutions。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .query_builder import build_where, safe_order

if TYPE_CHECKING:
    from app.core.runtime.scheduled_execution import ScheduledExecution

STATUS_RUNNING = "running"
STATUS_PENDING = "pending"
STATUS_RETRYING = "retrying"
RECOVERABLE_STATUSES = (STATUS_PENDING, STATUS_RETRYING)

_ORDER_BY_CREATED_ASC = {"asc": "created_at ASC"}
_BASE_SELECT = "SELECT * FROM handler_executions"


def read_scheduled_execution(db: Any, execution_id: str) -> "ScheduledExecution | None":
    """按 id 读取一条 ScheduledExecution（O(1) 投影查询）。"""
    from app.core.runtime.scheduled_execution import ScheduledExecution

    with db.get_db() as conn:
        row = conn.execute(
            f"{_BASE_SELECT} WHERE id = ?",
            (execution_id,),
        ).fetchone()
    if row is None:
        return None
    return ScheduledExecution.from_row(dict(row))


def read_scheduled_executions(
    db: Any,
    status: str | None = None,
    instance_id: str | None = None,
) -> list["ScheduledExecution"]:
    """从 handler_executions 投影读取 ScheduledExecutions。"""
    from app.core.runtime.scheduled_execution import ScheduledExecution

    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    if instance_id is not None:
        clauses.append("instance_id = ?")
        params.append(instance_id)
    where = build_where(clauses)
    order_sql = safe_order("asc", _ORDER_BY_CREATED_ASC, default_key="asc")
    with db.get_db() as conn:
        rows = conn.execute(
            f"{_BASE_SELECT}{where}{order_sql}",
            params,
        ).fetchall()
    return [ScheduledExecution.from_row(dict(r)) for r in rows]


def recover_scheduled_executions(
    db: Any,
) -> tuple[list["ScheduledExecution"], list["ScheduledExecution"]]:
    """扫描重启后需要恢复的 ScheduledExecutions。

    返回 ``(running, pending)``。不做任何写入。
    """
    from app.core.runtime.scheduled_execution import ScheduledExecution

    order_sql = safe_order("asc", _ORDER_BY_CREATED_ASC, default_key="asc")

    placeholders = ",".join("?" * len(RECOVERABLE_STATUSES))
    with db.get_db() as conn:
        running_rows = conn.execute(
            f"{_BASE_SELECT} WHERE status = ?{order_sql}",
            (STATUS_RUNNING,),
        ).fetchall()
        pending_rows = conn.execute(
            f"{_BASE_SELECT} WHERE status IN ({placeholders}){order_sql}",
            tuple(RECOVERABLE_STATUSES),
        ).fetchall()
    running = [ScheduledExecution.from_row(dict(r)) for r in running_rows]
    pending = [ScheduledExecution.from_row(dict(r)) for r in pending_rows]
    return running, pending


def count_scheduled_executions_by_status(db: Any) -> dict[str, int]:
    """返回全部 handler_executions 行的 ``{status: count}``。"""
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS c FROM handler_executions GROUP BY status"
        ).fetchall()
    return {str(r["status"]): int(r["c"]) for r in rows}
