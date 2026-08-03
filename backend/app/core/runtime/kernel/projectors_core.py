"""核心投影器——approval / memory / work_item / user_profile / notification。

各读模型表仅由对应聚合事件派生，可完全从事件日志重建。
"""

import json

from .event import Event
from .projectors_registry import _OWNED_TABLES, projector

# --- Approval 投影 ------------------------------------------------------------
# ``approvals`` 表是治理读模型。

_OWNED_TABLES["approval"] = ["approvals"]


@projector("ApprovalRequested")
def _on_approval_requested(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO approvals (id, task_id, action, params, proposed_by, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (
            event.aggregate_id,
            p.get("ctx", {}).get("task_id"),
            p.get("action", ""),
            json.dumps(p.get("ctx", {}).get("args", {})),
            event.actor,
            event.ts,
            p.get("expires_at"),
        ),
    )


@projector("ApprovalGranted")
def _on_approval_granted(event: Event, conn) -> None:
    conn.execute(
        "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?",
        ("approved", event.ts, event.actor, event.aggregate_id),
    )


@projector("ApprovalDenied")
def _on_approval_denied(event: Event, conn) -> None:
    p = event.payload
    status = "expired" if p.get("reason") == "auto_expired" else "denied"
    # 幂等：只迁移 pending 行（重复 emit 下安全）。
    conn.execute(
        "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ? "
        "WHERE id = ? AND status = 'pending'",
        (status, event.ts, event.actor, event.aggregate_id),
    )


# --- Memory 投影 ---------------------------------------------------------------
# ``memories`` 表是派生信念的投影。

_OWNED_TABLES["memory"] = ["memories"]


def origin_from_actor(actor: str) -> str:
    """把事件 actor 映射为记忆来源（Meaning Boundary G2）。

    只有用户显式撰写的用户事件是 self_report，其余都是 claim。
    """
    if actor == "user":
        return "self_report"
    return "claim"


def initial_claim_status(origin: str) -> str | None:
    """Meaning Boundary G1：claim 以 proposed 起步；self-report 跳过 Authority。"""
    return "proposed" if origin == "claim" else None


def _set_claim_status_if_claim(conn, memory_id: str, status: str) -> None:
    """只对 origin=claim 的行应用认知状态。"""
    row = conn.execute(
        "SELECT origin FROM memories WHERE id = ?", (memory_id,)
    ).fetchone()
    if row and row["origin"] == "claim":
        conn.execute(
            "UPDATE memories SET claim_status = ? WHERE id = ?",
            (status, memory_id),
        )


@projector("MemoryDerived")
def _on_memory_derived(event: Event, conn) -> None:
    p = event.payload
    origin = origin_from_actor(event.actor)
    claim_status = initial_claim_status(origin)
    conn.execute(
        """INSERT OR REPLACE INTO memories
           (id, category, content, source, embedding_id, confidence,
            derived_from_event, created_at, origin, claim_status,
            source_document_id, source_document_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            event.aggregate_id,
            p.get("category", "general"),
            p.get("content", ""),
            p.get("source", ""),
            p.get("embedding_id"),
            p.get("confidence", 0.5),
            p.get("derived_from_event", event.caused_by),
            event.ts,
            origin,
            claim_status,
            p.get("source_document_id"),
            p.get("source_document_name"),
        ),
    )


@projector("MemoryDecayed")
def _on_memory_decayed(event: Event, conn) -> None:
    p = event.payload
    new_confidence = float(p.get("confidence", 0.1))
    conn.execute(
        "UPDATE memories SET confidence = ?, decayed_at = ? WHERE id = ?",
        (new_confidence, event.ts, event.aggregate_id),
    )


@projector("MemoryRevoked")
def _on_memory_revoked(event: Event, conn) -> None:
    """记忆被新证据反驳——置信度归零。"""
    conn.execute(
        "UPDATE memories SET confidence = 0.0, decayed_at = ? WHERE id = ?",
        (event.ts, event.aggregate_id),
    )


@projector("MemoryUpdated")
def _on_memory_updated(event: Event, conn) -> None:
    p = event.payload
    updatable = ("content", "category", "source", "confidence", "embedding_id")
    fields = [k for k in updatable if k in p]
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    params = [p[k] for k in fields]
    params.append(event.aggregate_id)
    conn.execute(
        f"UPDATE memories SET {set_clause} WHERE id = ?",
        params,
    )


@projector("MemoryDeleted")
def _on_memory_deleted(event: Event, conn) -> None:
    conn.execute("DELETE FROM memories WHERE id = ?", (event.aggregate_id,))


# --- WorkItem 投影 ---------------------------------------------------------------
# ``work_items`` 表容纳全部工作类型（task / action / background / goal）。

_OWNED_TABLES["work_item"] = ["work_items"]


@projector("WorkItemCreated")
def _on_work_item_created(event: Event, conn) -> None:
    p = event.payload
    # Goal 列：work_type='goal' 的 WorkItemCreated 会填充
    # progress/importance/urgency/deadline/last_activity_at；其余 work_type
    # 回退到 schema 默认值（progress=0、importance=urgency=0.5、
    # deadline/last_activity_at=NULL）。
    conn.execute(
        """INSERT OR REPLACE INTO work_items
           (id, title, description, work_type, parent_work_id, parent_goal_id,
            status, priority, dependencies_json, executable_plan, created_at, updated_at,
            progress, importance, urgency, deadline, last_activity_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            event.aggregate_id,
            p.get("title", ""),
            p.get("description", ""),
            p.get("work_type", "task"),
            p.get("parent_work_id"),
            p.get("parent_goal_id"),
            p.get("status", "pending"),
            p.get("priority", 0),
            p.get("dependencies_json"),
            p.get("executable_plan"),
            p.get("created_at", event.ts),
            event.ts,
            # v1.0 goal 字段——仅在 work_type='goal' 时出现在 payload。
            # 默认值与 schema server_default 一致，保证非 goal 行的重建输出
            # 与 v1.0 之前逐字节一致。
            p.get("progress", 0),
            p.get("importance", 0.5),
            p.get("urgency", 0.5),
            p.get("deadline"),
            p.get("last_activity_at"),
        ),
    )

    # 在 goal 下新建子项后重算父级进度，保持子项计数一致。不做这一步，
    # 在部分兄弟已完成后再加子项会让父级进度一直陈旧，直到下次状态变更。
    _recalculate_parent_goal_progress(conn, event.aggregate_id, event.ts)


@projector("WorkItemUpdated")
def _on_work_item_updated(event: Event, conn) -> None:
    p = event.payload
    updatable = ("title", "description", "status", "priority",
                 "dependencies_json", "executable_plan", "completed_at",
                 "parent_work_id", "parent_goal_id",
                 "progress", "importance", "urgency", "deadline",
                 "last_activity_at")
    fields = [k for k in updatable if k in p]
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    params = [p[k] for k in fields]
    params.append(event.ts)
    params.append(event.aggregate_id)
    conn.execute(
        f"UPDATE work_items SET {set_clause}, updated_at = ? WHERE id = ?",
        params,
    )


@projector("WorkItemStatusChanged")
def _on_work_item_status_changed(event: Event, conn) -> None:
    status = event.payload.get("status")
    if not status:
        return
    extra = []
    vals = [status, event.ts]
    if status == "completed":
        extra.append("completed_at = ?")
        vals.append(event.ts)
        # v1.0 修正：goal/task 完成时确保 progress 为 1.0。
        extra.append("progress = 1.0")
    completed_clause = ", " + ", ".join(extra) if extra else ""
    vals.append(event.aggregate_id)
    conn.execute(
        f"UPDATE work_items SET status = ?, updated_at = ?{completed_clause} WHERE id = ?",
        vals,
    )

    # 子项状态变更时派生父 goal 的进度。纯投影（同一事务）——重建会得到
    # 逐字节一致的状态，因为相同事件序列重放了同一计算。
    _recalculate_parent_goal_progress(conn, event.aggregate_id, event.ts)


def _recalculate_parent_goal_progress(
    conn, child_id: str, ts: str, parent_id_hint: str | None = None,
) -> None:
    """子 work_item 状态变更 / 创建 / 删除时，重算父 goal 的进度
    为 completed_children / total_children（仅当父项是 goal）。在投影器的
    事务内做纯 SQL——不发事件，因此无递归风险。

    Progress = completed / total（只统计该父项的子项）。

    ``parent_id_hint`` 让已知父项的调用方（如删除路径——必须在行消失前
    捕获它）跳过查找。
    """
    parent_id = parent_id_hint
    if parent_id is None:
        # 查找刚变更子项的父引用。
        row = conn.execute(
            "SELECT parent_work_id, parent_goal_id FROM work_items WHERE id = ?",
            (child_id,),
        ).fetchone()
        if row is None:
            return
        parent_id = row["parent_work_id"] or row["parent_goal_id"]
    if not parent_id:
        return

    # 只有父项是 goal 才重算（task 不追踪进度）。
    parent = conn.execute(
        "SELECT work_type FROM work_items WHERE id = ?", (parent_id,),
    ).fetchone()
    if parent is None or parent["work_type"] != "goal":
        return

    # 统计子项与已完成子项。子项经 parent_work_id 或 parent_goal_id
    # 引用 goal。
    children = conn.execute(
        "SELECT status FROM work_items "
        "WHERE parent_work_id = ? OR parent_goal_id = ?",
        (parent_id, parent_id),
    ).fetchall()
    if not children:
        # 没有子项了——重置进度为 0（避免残留陈旧非零值）。
        conn.execute(
            "UPDATE work_items SET progress = 0, last_activity_at = ?, updated_at = ? "
            "WHERE id = ?",
            (ts, ts, parent_id),
        )
        return
    total = len(children)
    completed = sum(1 for c in children if c["status"] == "completed")
    progress = completed / total if total > 0 else 0.0

    conn.execute(
        "UPDATE work_items SET progress = ?, last_activity_at = ?, updated_at = ? "
        "WHERE id = ?",
        (progress, ts, ts, parent_id),
    )


@projector("WorkItemDeleted")
def _on_work_item_deleted(event: Event, conn) -> None:
    # 删除前捕获父引用，以便子行消失后重算父 goal 进度。
    row = conn.execute(
        "SELECT parent_work_id, parent_goal_id FROM work_items WHERE id = ?",
        (event.aggregate_id,),
    ).fetchone()
    parent_id = row["parent_work_id"] or row["parent_goal_id"] if row else None

    conn.execute("DELETE FROM work_items WHERE id = ?", (event.aggregate_id,))

    if parent_id:
        _recalculate_parent_goal_progress(conn, event.aggregate_id, event.ts)


# --- Claim 权威投影（Meaning Boundary G1）------------------------------------


@projector("ClaimRatified")
def _on_claim_ratified(event: Event, conn) -> None:
    _set_claim_status_if_claim(conn, event.aggregate_id, "ratified")


@projector("ClaimRejected")
def _on_claim_rejected(event: Event, conn) -> None:
    _set_claim_status_if_claim(conn, event.aggregate_id, "rejected")


@projector("ClaimContested")
def _on_claim_contested(event: Event, conn) -> None:
    _set_claim_status_if_claim(conn, event.aggregate_id, "contested")


@projector("ClaimReleased")
def _on_claim_released(event: Event, conn) -> None:
    _set_claim_status_if_claim(conn, event.aggregate_id, "released")


@projector("ClaimReopened")
def _on_claim_reopened(event: Event, conn) -> None:
    _set_claim_status_if_claim(conn, event.aggregate_id, "contested")


@projector("ClaimRevised")
def _on_claim_revised(event: Event, conn) -> None:
    p = event.payload
    row = conn.execute(
        "SELECT origin FROM memories WHERE id = ?", (event.aggregate_id,)
    ).fetchone()
    if not row or row["origin"] != "claim":
        return
    updatable = ("content", "confidence")
    fields = [k for k in updatable if k in p]
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        params = [p[k] for k in fields]
        params.append(event.aggregate_id)
        conn.execute(
            f"UPDATE memories SET {set_clause} WHERE id = ?",
            params,
        )
    conn.execute(
        "UPDATE memories SET claim_status = 'proposed' WHERE id = ?",
        (event.aggregate_id,),
    )


# --- User Profile 投影 ----------------------------------------------------------

_OWNED_TABLES["user_profile"] = ["user_profile"]


@projector("UserProfileUpdated")
def _on_user_profile_updated(event: Event, conn) -> None:
    p = event.payload
    category = p["category"]
    # 更新时保留 created_at（INSERT OR REPLACE 会抹掉它）。
    conn.execute(
        """INSERT INTO user_profile
           (id, category, data_json, confidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             data_json = excluded.data_json,
             confidence = excluded.confidence,
             updated_at = excluded.updated_at""",
        (
            category,
            category,
            p["data_json"],
            p["confidence"],
            event.ts,
            event.ts,
        ),
    )


# --- Notification 投影 ----------------------------------------------------------

_OWNED_TABLES["notification"] = ["notifications"]


@projector("NotificationCreated")
def _on_notification_created(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO notifications
           (id, type, title, content, read,
            related_id, related_type, notification_type, dedup_key, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)""",
        (
            event.aggregate_id,
            p.get("type", ""),
            p.get("title", ""),
            p.get("content", ""),
            p.get("related_id"),
            p.get("related_type"),
            p.get("notification_type"),
            p.get("dedup_key"),
            p.get("created_at", event.ts),
        ),
    )


@projector("NotificationUpdated")
def _on_notification_updated(event: Event, conn) -> None:
    p = event.payload
    if "related_id" in p or "related_type" in p:
        conn.execute(
            """UPDATE notifications
               SET content = ?, related_id = COALESCE(?, related_id),
                   related_type = COALESCE(?, related_type)
               WHERE id = ?""",
            (
                p.get("content", ""),
                p.get("related_id"),
                p.get("related_type"),
                event.aggregate_id,
            ),
        )
    else:
        conn.execute(
            "UPDATE notifications SET content = ? WHERE id = ?",
            (p.get("content", ""), event.aggregate_id),
        )


@projector("NotificationRead")
def _on_notification_read(event: Event, conn) -> None:
    if event.aggregate_id == "all":
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        return
    conn.execute(
        "UPDATE notifications SET read = 1 WHERE id = ?",
        (event.aggregate_id,),
    )

