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

import hashlib
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
    """Atomically claim a plan resume (DELETE … RETURNING).

    Concurrent callers cannot both observe the same row: only one DELETE
    wins and returns the row.
    """
    if not approval_id:
        return None
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    with database.get_db() as conn:
        row = conn.execute(
            "DELETE FROM plan_resumes WHERE approval_id = ? RETURNING *",
            (approval_id,),
        ).fetchone()
    if row is None:
        return None
    return PlanResume.from_row(row)


def approval_dispatch_key(approval_id: str) -> str:
    return f"aprdis:{approval_id}"


def save_approval_dispatch_intent(
    approval_id: str,
    resume: PlanResume,
    *,
    result: str,
    dispatched: bool = False,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """Persist resume coordinates until ExecuteRequested is confirmed."""
    if not approval_id:
        return
    step_index = max(int(resume.resume_from) - 1, 0)
    prev = dict(resume.previous_output or {})
    prev["result"] = result
    prev["status"] = "success"
    prev["step"] = step_index
    prev["dispatched"] = bool(dispatched)
    register_plan_resume(
        approval_dispatch_key(approval_id),
        PlanResume(
            kind="execute",
            resume_from=int(resume.resume_from),
            previous_output=prev,
            action_id=resume.action_id,
            task_id=resume.task_id,
            plan_json=resume.plan_json,
        ),
        db=db,
        kernel=kernel,
    )


def load_approval_dispatch_intent(
    approval_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> PlanResume | None:
    if not approval_id:
        return None
    return peek_plan_resume(
        approval_dispatch_key(approval_id), db=db, kernel=kernel,
    )


def clear_approval_dispatch_intent(
    approval_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    if not approval_id:
        return
    take_plan_resume(approval_dispatch_key(approval_id), db=db, kernel=kernel)


def dispatch_intent_result(resume: PlanResume | None) -> str | None:
    if resume is None or not resume.previous_output:
        return None
    if resume.previous_output.get("status") != "success":
        return None
    result = resume.previous_output.get("result")
    return result if isinstance(result, str) else None


def dispatch_intent_is_done(resume: PlanResume | None) -> bool:
    if resume is None or not resume.previous_output:
        return False
    return bool(resume.previous_output.get("dispatched"))


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


def take_plan_resumes_for_work_item(
    work_item_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> list[tuple[str, PlanResume]]:
    """Delete and return operational resumes for one work item."""
    if not work_item_id:
        return []
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    with database.get_db() as conn:
        rows = conn.execute(
            "DELETE FROM plan_resumes WHERE kind = ? AND action_id = ? RETURNING *",
            ("execute", work_item_id),
        ).fetchall()
    return [(str(row["approval_id"]), PlanResume.from_row(row)) for row in rows]


def restore_plan_resumes_for_work_item(
    rows: list[tuple[str, PlanResume]],
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> list[tuple[str, PlanResume]]:
    """Put back resumes taken by ``take_plan_resumes_for_work_item``."""
    for approval_id, resume in rows:
        register_plan_resume(approval_id, resume, db=db, kernel=kernel)
    return list(rows)


def clear_plan_resumes(*, db: Any | None = None) -> None:
    """删除全部恢复行（测试助手）。"""
    database = _resolve_db(db)
    with database.get_db() as conn:
        conn.execute("DELETE FROM plan_resumes")


# ── Step progress / idempotency (APP_STORAGE via plan_resumes) ─────────────
# Synthetic approval_id keys keep zero new tables / event types:
#   progress:{action_id}              — last completed step_index + output
#   idem:{correlation_id}:{step}      — successful step result for replay skip
#   stepres:{action_id}:{step}        — full step result for compile after resume
#   aprdis:{approval_id}              — approve→execute dispatch intent until emit confirms
#   chat_ckpt:{correlation_id}        — Chat tool-loop messages for interrupt replay


def progress_key(action_id: str) -> str:
    return f"progress:{action_id}"


def idempotency_key(correlation_id: str, step_index: int) -> str:
    return f"idem:{correlation_id}:{int(step_index)}"


def action_step_key(action_id: str, step_index: int) -> str:
    return f"stepres:{action_id}:{int(step_index)}"


def save_plan_progress(
    action_id: str,
    *,
    resume_from: int,
    previous_output: dict[str, Any] | None = None,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """Persist step progress so retries resume after the last success (E-5)."""
    if not action_id:
        return
    register_plan_resume(
        progress_key(action_id),
        PlanResume(
            kind="execute",
            resume_from=int(resume_from),
            previous_output=previous_output,
            action_id=action_id,
        ),
        db=db,
        kernel=kernel,
    )


def load_plan_progress(
    action_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> PlanResume | None:
    if not action_id:
        return None
    return peek_plan_resume(progress_key(action_id), db=db, kernel=kernel)


def record_step_success(
    correlation_id: str,
    step_index: int,
    result: str,
    *,
    action_id: str = "",
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """Record a successful step under correlation and action keys (E-1)."""
    row = PlanResume(
        kind="execute",
        resume_from=int(step_index) + 1,
        previous_output={"result": result, "status": "success"},
        action_id=action_id or "",
    )
    if correlation_id:
        register_plan_resume(
            idempotency_key(correlation_id, step_index),
            row,
            db=db,
            kernel=kernel,
        )
    if action_id:
        register_plan_resume(
            action_step_key(action_id, step_index),
            row,
            db=db,
            kernel=kernel,
        )


def lookup_step_success(
    correlation_id: str,
    step_index: int,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> str | None:
    """Return cached step result if this correlation already succeeded at step."""
    if not correlation_id:
        return None
    row = peek_plan_resume(
        idempotency_key(correlation_id, step_index), db=db, kernel=kernel,
    )
    return _success_result(row)


def lookup_action_step_success(
    action_id: str,
    step_index: int,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> str | None:
    """Return cached full step result keyed by work/action id (survives new correlation)."""
    if not action_id:
        return None
    row = peek_plan_resume(
        action_step_key(action_id, step_index), db=db, kernel=kernel,
    )
    return _success_result(row)


def _success_result(row: PlanResume | None) -> str | None:
    """从缓存行提取成功结果；非成功 / 形状不符返回 None。"""
    if row is None or not row.previous_output:
        return None
    if row.previous_output.get("status") != "success":
        return None
    result = row.previous_output.get("result")
    return result if isinstance(result, str) else None


# ── Capability 调用意图 / chat 工具幂等（APP_STORAGE via plan_resumes）──────
# 合成键延续零新增表 / 零新增事件类型的模式：
#   cap_intent:{invocation_id}          — write-class 调用已开始、审计事件未落库
#   idem:{correlation_id}:chat:{digest} — chat 工具环成功结果，重放去重


CAPABILITY_INTENT_PREFIX = "cap_intent:"


def capability_intent_key(invocation_id: str) -> str:
    return f"{CAPABILITY_INTENT_PREFIX}{invocation_id}"


def _running_retry_count(kernel: Any, execution_id: str) -> int | None:
    """Lane A 行上、调用进行中的 ``retry_count``。没有行时返回 None。"""
    try:
        row = kernel.read_scheduled_execution(execution_id)
    except Exception:
        logger.debug("capability intent retry_count lookup failed", exc_info=True)
        return None
    if row is None:
        return None
    try:
        return int(row.retry_count)
    except (TypeError, ValueError, AttributeError):
        return None


def record_capability_intent(
    invocation_id: str,
    *,
    name: str,
    args_summary: str,
    actor: str,
    correlation_id: str | None = None,
    execution_id: str | None = None,
    caused_by: str | None = None,
    retry_count: int | None = None,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """在外部副作用发生前持久化调用意图（收窄审计双写窗口）。

    审计事件（CapabilityInvoked / CapabilityFailed）落库后由
    :func:`clear_capability_intent` 清除；进程在窗口内死亡时，遗留行由
    启动清扫补发 ``CapabilityFailed(error=interrupted_before_audit)``。

    ``execution_id`` 缺省时取当前 ``execution_scope``。``caused_by`` 缺省为
    该执行 id，与 ``invoke_capability`` 把执行 id 写入 ``caused_by`` 的约定
    一致。``retry_count`` 缺省读该执行的投影行，供恢复计数按同一次中断对齐。
    """
    if not invocation_id:
        return
    from app.core.runtime.execution import get_current_execution_id

    resolved_execution = str(execution_id or "").strip()
    if not resolved_execution:
        resolved_execution = str(get_current_execution_id() or "").strip()
    resolved_caused = str(caused_by or "").strip() or resolved_execution
    resolved_retry = retry_count
    if resolved_retry is None and resolved_execution and kernel is not None:
        resolved_retry = _running_retry_count(kernel, resolved_execution)
    previous: dict[str, Any] = {
        "name": name,
        "args_summary": args_summary,
        "actor": actor,
        "correlation_id": correlation_id or "",
        "execution_id": resolved_execution,
        "caused_by": resolved_caused,
    }
    if resolved_retry is not None:
        previous["retry_count"] = int(resolved_retry)
    register_plan_resume(
        capability_intent_key(invocation_id),
        PlanResume(
            kind="execute",
            resume_from=0,
            previous_output=previous,
        ),
        db=db,
        kernel=kernel,
    )


def clear_capability_intent(
    invocation_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """审计事件已落库——清除对应调用意图行。"""
    if not invocation_id:
        return
    take_plan_resume(capability_intent_key(invocation_id), db=db, kernel=kernel)


def take_stale_capability_intents(
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> list[dict[str, Any]]:
    """取走并清除全部遗留调用意图（启动清扫）。

    行存在即说明上个进程在「副作用发生 → 审计事件落库」窗口内死亡，
    外部副作用**可能已发生**。返回意图 payload 列表供补发审计事件。
    """
    database = _resolve_db(db if db is not None else _db_from_kernel(kernel))
    with database.get_db() as conn:
        rows = conn.execute(
            "DELETE FROM plan_resumes WHERE approval_id LIKE ? RETURNING *",
            (f"{CAPABILITY_INTENT_PREFIX}%",),
        ).fetchall()
    intents: list[dict[str, Any]] = []
    for row in rows:
        resume = PlanResume.from_row(row)
        payload = dict(resume.previous_output or {})
        payload["intent_key"] = row["approval_id"]
        intents.append(payload)
    return intents


def chat_idempotency_key(
    correlation_id: str, tool_name: str, args: dict[str, Any] | None
) -> str:
    """chat 工具环合成幂等键（与 plan 步骤 ``idem:{corr}:{step}`` 同款模式）。

    chat 重放时 LLM 重新生成 tool_call_id，故键取 correlation + 工具名 +
    规范化参数摘要：同一轮（correlation）内相同 write-class 调用视为同一次。
    """
    canonical = json.dumps(args or {}, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(f"{tool_name}\n{canonical}".encode()).hexdigest()[:16]
    return f"idem:{correlation_id}:chat:{digest}"


def record_chat_tool_success(
    correlation_id: str,
    tool_name: str,
    args: dict[str, Any] | None,
    result: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """记录 chat 工具环一次成功的 write-class 调用（重放去重用）。"""
    if not correlation_id:
        return
    register_plan_resume(
        chat_idempotency_key(correlation_id, tool_name, args),
        PlanResume(
            kind="execute",
            resume_from=0,
            previous_output={"result": result, "status": "success"},
        ),
        db=db,
        kernel=kernel,
    )


def lookup_chat_tool_success(
    correlation_id: str,
    tool_name: str,
    args: dict[str, Any] | None,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> str | None:
    """同一 correlation 已成功执行过相同调用时返回缓存结果。"""
    if not correlation_id:
        return None
    row = peek_plan_resume(
        chat_idempotency_key(correlation_id, tool_name, args), db=db, kernel=kernel,
    )
    return _success_result(row)


CHAT_CHECKPOINT_PREFIX = "chat_ckpt:"


def chat_checkpoint_key(correlation_id: str) -> str:
    return f"{CHAT_CHECKPOINT_PREFIX}{correlation_id}"


def record_chat_checkpoint(
    correlation_id: str,
    payload: dict[str, Any],
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    """Persist Chat tool-loop cursor so interrupt replay can resume mid-turn."""
    if not correlation_id:
        return
    register_plan_resume(
        chat_checkpoint_key(correlation_id),
        PlanResume(
            kind="execute",
            resume_from=int(payload.get("iteration") or 0),
            previous_output=payload,
        ),
        db=db,
        kernel=kernel,
    )


def load_chat_checkpoint(
    correlation_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> dict[str, Any] | None:
    if not correlation_id:
        return None
    row = peek_plan_resume(
        chat_checkpoint_key(correlation_id), db=db, kernel=kernel,
    )
    if row is None:
        return None
    payload = dict(row.previous_output or {})
    return payload or None


def clear_chat_checkpoint(
    correlation_id: str,
    *,
    db: Any | None = None,
    kernel: Any | None = None,
) -> None:
    if not correlation_id:
        return
    take_plan_resume(
        chat_checkpoint_key(correlation_id), db=db, kernel=kernel,
    )


def approval_correlation_id(approval_id: str, *, kernel: Any) -> str:
    """Resolve an approval's durable originating correlation id."""
    if not approval_id:
        return ""
    try:
        events = kernel.read_events(
            type="ApprovalRequested",
            aggregate_id=approval_id,
            limit=5,
        )
    except Exception:
        logger.debug("approval correlation lookup failed", exc_info=True)
        return ""
    for event in events:
        correlation_id = getattr(event, "correlation_id", None) or ""
        if correlation_id:
            return str(correlation_id)
    return ""


def clear_chat_checkpoint_for_approval(
    approval_id: str,
    *,
    kernel: Any,
) -> str:
    """Clear a waiting chat checkpoint on approval denial or expiry."""
    correlation_id = approval_correlation_id(approval_id, kernel=kernel)
    if correlation_id:
        clear_chat_checkpoint(correlation_id, kernel=kernel)
    return correlation_id
