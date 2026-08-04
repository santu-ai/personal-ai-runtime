"""事件原语——Runtime 中唯一不可变的事实来源。

按 docs/RUNTIME_SPEC.md（v1.0 FROZEN）：事件只追加、按 ``seq`` 排序、
不可变、可重放。State 与 Memory 都是由事件派生的投影；事件日志本身
是唯一不可重建的东西。
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def _new_id() -> str:
    return f"evt_{uuid.uuid4().hex}"


@dataclass(frozen=True)
class Event:
    """一条不可变事实。刻意 frozen——一旦发出永不再变。

    字段语义：
        seq            全局单调序号（由日志分配，不是时间）
        id             事件唯一 id
        type           如 GoalCreated / GoalUpdated / GoalCompleted
        aggregate_type 所属聚合类型（如 "goal"）
        aggregate_id   具体聚合实例（如 "goal-123"）
        actor          触发者（user / agent:xxx / kernel / scheduler）
        payload        事件数据（发出时压入 schema_version）
        caused_by      直接因果前驱事件 id（一跳）
        correlation_id 同一意图所有事件共享的 trace id
        ts             墙钟时间戳（仅展示；排序靠 seq）
    """

    type: str
    aggregate_type: str
    aggregate_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    actor: str = "system"
    caused_by: str | None = None
    correlation_id: str | None = None
    id: str = field(default_factory=_new_id)
    seq: int | None = None  # 事件日志追加时分配
    ts: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def with_seq(self, seq: int) -> "Event":
        """返回带日志分配序号的新副本。"""
        return Event(
            type=self.type,
            aggregate_type=self.aggregate_type,
            aggregate_id=self.aggregate_id,
            payload=self.payload,
            actor=self.actor,
            caused_by=self.caused_by,
            correlation_id=self.correlation_id,
            id=self.id,
            seq=seq,
            ts=self.ts,
        )

    @classmethod
    def create(
        cls,
        *,
        type: str,
        aggregate_type: str,
        aggregate_id: str,
        payload: dict[str, Any] | None = None,
        actor: str = "system",
        caused_by: str | None = None,
        correlation_id: str | None = None,
    ) -> "Event":
        """构建事件，并把 ``schema_version`` 压入 payload。"""
        from app.core.runtime.kernel.constants import stamp_event_payload

        return cls(
            type=type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=stamp_event_payload(type, payload),
            actor=actor,
            caused_by=caused_by,
            correlation_id=correlation_id,
        )

    @classmethod
    def from_row(cls, row: Any) -> "Event":
        return cls(
            type=row["type"],
            aggregate_type=row["aggregate_type"],
            aggregate_id=row["aggregate_id"],
            payload=json.loads(row["payload"]) if row["payload"] else {},
            actor=row["actor"],
            caused_by=row["caused_by"],
            correlation_id=row["correlation_id"],
            id=row["id"],
            seq=row["seq"],
            ts=row["ts"],
        )
