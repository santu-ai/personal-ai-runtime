"""因审批暂停的计划步骤的持久化恢复注册表。

Execute 命中 ``pending`` 时，把 approval_id 映射到剩余计划，使
``ApproveRequested`` 在获批工具运行后可重新派发。

放在 ``handlers/`` 之外：过期 / 治理清除条目时无需导入 handler 包
（避免 ``@subscribe`` 注册的副作用）。

**持久性：** 行存在 APP_STORAGE 的 ``plan_resumes``（SQLite），以
``approval_id`` 为键。进程重启后 pending 的恢复保留；在 take / deny /
自动过期时清除。这是操作性的续接状态——不是受治理事实（审批行仍是治理
权威）。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal

ResumeKind = Literal["execute"]

logger = logging.getLogger(__name__)

# 测试覆盖——生产环境经 ``app.store.database.db`` 解析。
_db_override: Any | None = None


@dataclass(frozen=True)
class PlanResume:
    kind: ResumeKind
    resume_from: int
    previous_output: dict[str, Any] | None = None
    action_id: str = ""
    task_id: str = ""
    plan_json: str = ""

    def with_step_output(self, step_index: int, result: str, *, limit: int = 1000) -> PlanResume:
        """返回设置 ``step_{n}_output`` 后的副本（Approve → resume 交接）。"""
        prev = dict(self.previous_output or {})
        if step_index >= 0:
            prev[f"step_{step_index}_output"] = result[:limit]
        return replace(self, previous_output=prev)

    def to_row(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "resume_from": int(self.resume_from),
            "previous_output_json": json.dumps(
                self.previous_output or {}, ensure_ascii=False
            ),
            "action_id": self.action_id or "",
            "task_id": self.task_id or "",
            "plan_json": self.plan_json or "",
        }

    @classmethod
    def from_row(cls, row: Any) -> PlanResume:
        raw = row["previous_output_json"]
        try:
            prev = json.loads(raw or "{}")
        except (TypeError, json.JSONDecodeError):
            prev = {}
        if not isinstance(prev, dict):
            prev = {}
        kind = row["kind"]
        if kind != "execute":
            # 遗留 kind=background 的行已由 alembic 清理；按 execute 处理。
            kind = "execute"
        return cls(
            kind=kind,  # type: ignore[arg-type]
            resume_from=int(row["resume_from"]),
            previous_output=prev or None,
            action_id=row["action_id"] or "",
            task_id=row["task_id"] or "",
            plan_json=row["plan_json"] or "",
        )


def configure_plan_resume_db(db: Any | None) -> None:
    """绑定 plan resume 使用的 Database（测试 / 显式 Kernel db）。"""
    global _db_override
    _db_override = db


def _resolve_db(db: Any | None = None) -> Any:
    if db is not None:
        return db
    if _db_override is not None:
        return _db_override
    from app.store.database import db as global_db

    return global_db


def _db_from_kernel(kernel: Any | None) -> Any | None:
    """优先用 Kernel 的 Database——仅当它是真实 store 实例时。"""
    if kernel is None:
        return None
    candidate = getattr(kernel, "_db", None)
    # 避免单元测试中的 MagicMock 自动属性。
    cls_name = type(candidate).__name__
    if candidate is None or cls_name == "MagicMock":
        return None
    return candidate


def register_plan_resume(
    approval_id: str,
    resume: PlanResume,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    if not approval_id:
        return
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    row = resume.to_row()
    now = datetime.now(UTC).isoformat()
    with database.get_db() as conn:
        conn.execute(
            """INSERT INTO plan_resumes
               (approval_id, kind, resume_from, previous_output_json,
                action_id, task_id, plan_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(approval_id) DO UPDATE SET
                 kind = excluded.kind,
                 resume_from = excluded.resume_from,
                 previous_output_json = excluded.previous_output_json,
                 action_id = excluded.action_id,
                 task_id = excluded.task_id,
                 plan_json = excluded.plan_json,
                 created_at = excluded.created_at""",
            (
                approval_id,
                row["kind"],
                row["resume_from"],
                row["previous_output_json"],
                row["action_id"],
                row["task_id"],
                row["plan_json"],
                now,
            ),
        )


def peek_plan_resume(
    approval_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> PlanResume | None:
    if not approval_id:
        return None
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    with database.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM plan_resumes WHERE approval_id = ?",
            (approval_id,),
        ).fetchone()
    if row is None:
        return None
    return PlanResume.from_row(row)


def take_plan_resume(
    approval_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> PlanResume | None:
    if not approval_id:
        return None
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    with database.get_db() as conn:
        row = conn.execute(
            "SELECT * FROM plan_resumes WHERE approval_id = ?",
            (approval_id,),
        ).fetchone()
        if row is None:
            return None
        conn.execute(
            "DELETE FROM plan_resumes WHERE approval_id = ?",
            (approval_id,),
        )
    return PlanResume.from_row(row)


def clear_plan_resumes_for_work_item(
    work_item_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> int:
    """删除某个工作项的持久化恢复（取消 / 清理）。"""
    if not work_item_id:
        return 0
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    with database.get_db() as conn:
        cur = conn.execute(
            "DELETE FROM plan_resumes WHERE kind = ? AND action_id = ?",
            ("execute", work_item_id),
        )
        return int(cur.rowcount or 0)


def clear_plan_resumes(*, db: Any | None = None) -> None:
    """删除全部恢复行（测试助手）。"""
    database = _resolve_db(db)
    with database.get_db() as conn:
        conn.execute("DELETE FROM plan_resumes")
