# mypy: disable-error-code="attr-defined"
"""Kernel Query State Mixin——只读投影查询。

SQL 执行器在 ``query_builder``（不计入 God Object LOC）。本 mixin 保留
``query_state`` 选择器路由与薄 ABI 包装。
"""

from __future__ import annotations

from typing import Any

from . import query_builder as qb

# 支持经 ``count_state`` 高效 SQL COUNT 的选择器。
COUNT_STATE_SELECTORS: frozenset[str] = frozenset({
    "work_items",
    "memories",
    "approvals",
    "notifications",
    "inbox_emails",
    "timer_events",
    "policy_events",
})


class QueryStateMixin:  # type: ignore[attr-defined]  # 混入 Kernel，其提供 _db
    """读层：query_state 与投影表访问器。"""

    def query_state(self, selector: str, **filters: Any) -> list[dict]:
        """读取投影。新调用点优先用 ``read_ports`` 助手。"""
        if selector == "work_items":  # 统一的 task + action + goal
            return self._as_rows(self._query_work_items(filters))
        if selector == "approvals":
            return self._as_rows(self._query_approvals(filters))
        if selector == "memories":
            return self._as_rows(self._query_memories(filters))
        if selector == "notifications":
            return self._as_rows(self._query_notifications(filters))
        if selector == "policy_events":
            return self._as_rows(self._query_policy_events(filters))
        if selector == "conversations":
            return self._as_rows(self._query_conversations(filters))
        if selector == "messages":
            return self._as_rows(self._query_messages(filters))
        if selector == "inbox_emails":
            return self._as_rows(self._query_inbox_emails(filters))
        if selector == "timer_events":
            return self._as_rows(self._query_timer_events(filters))
        if selector == "user_profile":
            return self._as_rows(self._query_user_profile(filters))
        if selector == "tool_calls":
            return self._as_rows(self._query_tool_calls(filters))
        if selector == "llm_calls":
            return self._as_rows(self._query_llm_calls(filters))
        raise ValueError(f"Unknown state selector: {selector!r}")

    @staticmethod
    def _as_rows(result: list[dict] | int) -> list[dict]:
        if isinstance(result, int):
            raise TypeError("count_only result passed to query_state")
        return result

    @staticmethod
    def supports_count_state(selector: str) -> bool:
        """selector 是否有真正的 COUNT 路径。"""
        return selector in COUNT_STATE_SELECTORS

    def count_state(self, selector: str, **filters: Any) -> int:
        """高效统计投影行数，不把行加载进内存。"""
        filters["count_only"] = True
        dispatch = {
            "work_items": self._query_work_items,
            "memories": self._query_memories,
            "approvals": self._query_approvals,
            "notifications": self._query_notifications,
            "inbox_emails": self._query_inbox_emails,
            "timer_events": self._query_timer_events,
            "policy_events": self._query_policy_events,
        }
        query = dispatch.get(selector)
        if query is None:
            raise ValueError(f"count_state not implemented for selector: {selector!r}")
        result = query(filters)
        if not isinstance(result, int):
            raise TypeError(f"count_only query for {selector!r} did not return int")
        return result

    def aggregate_state(self, selector: str, **filters: Any) -> Any:
        """对受治理投影做 SQL 聚合（无静默行上限）。"""
        if selector == "llm_calls_summary":
            return qb.aggregate_llm_calls_summary(self._db, filters)
        if selector == "llm_calls_by_model":
            return qb.aggregate_llm_calls_by_model(self._db, filters)
        if selector == "tool_calls_summary":
            return qb.aggregate_tool_calls_summary(self._db, filters)
        if selector == "call_failure_rates":
            return qb.aggregate_call_failure_rates(self._db, filters)
        if selector == "memory_stats":
            return qb.aggregate_memory_stats(self._db, filters)
        raise ValueError(f"Unknown aggregate selector: {selector!r}")

    def _query_work_items(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_work_items(self._db, filters)

    def _query_approvals(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_approvals(self._db, filters)

    def _query_memories(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_memories(self._db, filters)

    def _query_notifications(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_notifications(self._db, filters)

    def list_capability_definitions(self) -> list[dict]:
        """薄转发到 harness——优先用 ``mcp_hub.get_tool_defs_for_llm``。"""
        from app.core.harness.mcp_hub import mcp_hub

        return mcp_hub.get_tool_defs_for_llm()

    def recall_memory(self, query: str, k: int = 5) -> list[dict]:
        """经注入的 MemoryIndexPort 做语义召回（不绕过全局向量）。"""
        port = getattr(self, "_memory_index", None)
        if port is None:
            return []
        return port.search_memories(query, n_results=k)

    def _query_conversations(self, filters: dict[str, Any]) -> list[dict]:
        return qb.query_conversations(self._db, filters)

    def _query_messages(self, filters: dict[str, Any]) -> list[dict]:
        return qb.query_messages(self._db, filters)

    def _query_inbox_emails(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_inbox_emails(self._db, filters)

    def _query_policy_events(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_policy_events(self._db, filters)

    def _query_timer_events(self, filters: dict[str, Any]) -> list[dict] | int:
        return qb.query_timer_events(self._db, filters)

    def _query_user_profile(self, filters: dict[str, Any]) -> list[dict]:
        return qb.query_user_profile(self._db, filters)

    def _query_tool_calls(self, filters: dict[str, Any]) -> list[dict]:
        return qb.query_tool_calls(self._db, filters)

    def _query_llm_calls(self, filters: dict[str, Any]) -> list[dict]:
        return qb.query_llm_calls(self._db, filters)
