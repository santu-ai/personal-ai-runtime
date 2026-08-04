# mypy: disable-error-code="attr-defined"
"""Kernel Sovereignty Mixin——sovereignty_ops 的薄 ABI 包装。

导出/导入/重建的繁重逻辑在 ``sovereignty_ops``（不计入 God Object LOC）。
"""

from __future__ import annotations

from typing import Any

from . import sovereignty_ops as ops

# 为脚本 / 从 mixin 模块导入的调用方再导出。
EXPORT_FORMAT = ops.EXPORT_FORMAT


class SovereigntyMixin:  # type: ignore[attr-defined]
    """数据主权操作——导出、导入、重建。"""


    def _drop_event_log_guards(self, conn) -> None:
        return ops._drop_event_log_guards(self, conn)

    def _ensure_event_log_guards(self, conn) -> None:
        return ops._ensure_event_log_guards(self, conn)

    def export_event_log_rows(self, *, conn=None) -> list[dict[str, Any]]:
        """导出完整 event_log 以做无损快照（按 seq 游标分批）。"""
        return ops.export_event_log_rows(self, conn=conn)

    def import_event_log_rows(self, rows: list[dict[str, Any]], *, rebuild_projections: bool = True) -> int:
        """批量导入事件，保留 seq/id；可选重建全部投影。"""
        return ops.import_event_log_rows(self, rows, rebuild_projections=rebuild_projections)

    def table_counts(self, tables: tuple[str, ...]) -> dict[str, int]:
        """Kernel 空间的表行数统计，用于数据主权验证。"""
        return ops.table_counts(self, tables)

    def count_events(self, aggregate_type: str) -> int:
        """按 aggregate_type 统计 event_log 事件数（kernel-space）。"""
        return ops.count_events(self, aggregate_type)

    def bootstrap_chat_from_snapshot(self, conversations: list[dict[str, Any]], messages: list[dict[str, Any]], event_rows: list[dict[str, Any]]) -> dict[str, int]:
        """为遗留快照发出 chat 事件。"""
        return ops.bootstrap_chat_from_snapshot(self, conversations, messages, event_rows)

    def export_chat_rows(self, *, conn=None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """导出 conversation/message 投影（反规范化备份）。"""
        return ops.export_chat_rows(self, conn=conn)

    def _checkpoint_seq(self, agent_id: str, aggregate_type: str) -> int:
        """返回某 per-agent 检查点的 last_applied_seq（无则 0）。"""
        return ops._checkpoint_seq(self, agent_id, aggregate_type)

    def _restore_table_snapshot(self, conn, table: str, rows: list[dict[str, Any]]) -> None:
        return ops._restore_table_snapshot(self, conn, table, rows)

    def save_projection_snapshot(self, aggregate_type: str, agent_id: str = 'kernel') -> dict[str, Any]:
        """持久化投影表 + last_applied_seq 以支持增量重建。"""
        return ops.save_projection_snapshot(self, aggregate_type, agent_id)

    def save_projection_snapshots(self, aggregate_types: tuple[str, ...] | list[str] | None = None, agent_id: str = 'kernel') -> list[dict[str, Any]]:
        """为一个或多个聚合持久化检查点。"""
        return ops.save_projection_snapshots(self, aggregate_types, agent_id)

    def rebuild(self, aggregate_type: str, agent_id: str = 'kernel') -> int:
        """从事件日志重建投影（有检查点时增量）。"""
        return ops.rebuild(self, aggregate_type, agent_id)

    def rebuild_all(self) -> dict[str, int]:
        """重建全部已注册聚合类型。"""
        return ops.rebuild_all(self)

    def iter_snapshot_json_chunks(self):
        """产出无损快照 JSON 文档的 UTF-8 分块。"""
        yield from ops.iter_snapshot_json_chunks(self)

    def snapshot(self) -> dict[str, Any]:
        """导出完整个人快照为 dict。"""
        return ops.snapshot(self)

    def restore(self, snapshot: dict, read_only: bool = True) -> dict[str, Any]:
        """导入快照。写入式导入需 read_only=False。"""
        return ops.restore(self, snapshot, read_only)

    def _restore_from_snapshot(self, snapshot: dict) -> dict:
        """从基于 event_log 的快照恢复。"""
        return ops._restore_from_snapshot(self, snapshot)

    def _import_legacy_goals_memories(self, snapshot: dict) -> dict[str, Any]:
        """尽力导入旧的有损快照（仅 goals/memories）。"""
        return ops._import_legacy_goals_memories(self, snapshot)

    def erase(self) -> dict:
        """删除数据库与向量存储文件（不可逆）。"""
        return ops.erase(self)
