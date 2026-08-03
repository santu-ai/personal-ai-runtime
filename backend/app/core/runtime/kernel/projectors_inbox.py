"""收件箱邮件投影——仅从 InboxEmail* 事件派生 inbox_emails 表。

inbox_emails 是受治理投影：每一列都派生自事件，表可经
kernel.rebuild("inbox_email") 重建，且因为 INSERT 路径只存在于 Kernel
内部，verify_inbox_audit.py 可保证 1:1 对应。
"""

import json

from .constants import AGGREGATE_TIMER
from .event import Event
from .projectors_registry import _OWNED_TABLES, projector

_OWNED_TABLES["inbox_email"] = ["inbox_emails"]
_OWNED_TABLES[AGGREGATE_TIMER] = ["timer_events"]


@projector("InboxEmailRecorded")
def _on_inbox_email_recorded(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO inbox_emails
           (id, sender, subject, preview, received_at, category, importance,
            reason, notified, digested, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', ?)""",
        (
            event.aggregate_id,
            p.get("sender", ""),
            p.get("subject", ""),
            p.get("preview", ""),
            p.get("received_at", ""),
            p.get("category", "actionable"),
            p.get("importance", 0.5),
            p.get("reason", ""),
            p.get("created_at", event.ts),
        ),
    )


@projector("InboxEmailStatusChanged")
def _on_inbox_email_status_changed(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        "UPDATE inbox_emails SET status = ? WHERE id = ?",
        (p.get("status", "pending"), event.aggregate_id),
    )


@projector("InboxEmailFlagSet")
def _on_inbox_email_flag_set(event: Event, conn) -> None:
    flag = event.payload.get("flag", "notified")
    if flag == "digested":
        # 批量操作：把所有未消化的行标记为已消化。aggregate_id 携带消化
        # 批次 id；更新所有 digested = 0 的行，让投影收敛到「本事件之前
        # 发出的一切都已被消化」。
        conn.execute("UPDATE inbox_emails SET digested = 1 WHERE COALESCE(digested, 0) = 0")
    else:
        conn.execute(
            "UPDATE inbox_emails SET notified = 1 WHERE id = ?",
            (event.aggregate_id,),
        )


# --- Timer 投影（折叠在此以保持 runtime_files 零和）-------------------------
# timer_events 的 DDL 在 app.store.schema_ddl.TIMER_EVENTS_SCHEMA。


@projector("TimerCreated")
def _on_timer_created(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        """INSERT OR REPLACE INTO timer_events
           (id, handler_name, schedule_type, cron_expr, delay_seconds, fire_at,
            payload_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
        (
            event.aggregate_id,
            p.get("handler_name", ""),
            p.get("schedule_type", "cron"),
            p.get("cron_expr", ""),
            float(p.get("delay_seconds", 0)),
            p.get("fire_at", ""),
            json.dumps(p.get("payload", {}), ensure_ascii=False),
            event.ts,
        ),
    )


@projector("TimerFired")
def _on_timer_fired(event: Event, conn) -> None:
    p = event.payload
    conn.execute(
        "UPDATE timer_events SET status = 'fired', fired_at = ? WHERE id = ?",
        (p.get("fired_at", event.ts), event.aggregate_id),
    )
