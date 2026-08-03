"""受治理的 telemetry 投影读取器（llm_calls / tool_calls）。

放在 store 层是为了让 Kernel QueryStateMixin 保持精简 ——
这里允许 SELECT 受治理表（见 check_boundary._is_store_layer）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, TypedDict

if TYPE_CHECKING:
    from app.store.database import Database


class TelemetryRow(TypedDict):
    """telemetry 结果行的 Schema。"""
    id: str
    created_at: str
    success: int
    latency_ms: float
    # 其他字段依表而变（llm_calls 与 tool_calls 各不同）


def created_at_since_sql(
    since_days: int | None,
    *,
    column: str = "created_at",
) -> tuple[str | None, list[Any]]:
    """返回 ``(predicate, params)``，安全比较 ISO/SQLite 时间戳。

    事件时间戳是 ISO-8601（``…T…+00:00``）；SQLite ``datetime('now')`` 用空格分隔。
    把两侧都归一到 ``YYYY-MM-DD HH:MM:SS``。
    """
    if since_days is None:
        return None, []
    try:
        days_int = int(since_days)
    except (TypeError, ValueError):
        return None, []
    # substr(...,1,19) 去掉小数秒与时区后缀；
    # 将 T 替换为空格以对齐 SQLite datetime() 文本形式。
    normalized = f"datetime(replace(substr({column}, 1, 19), 'T', ' '))"
    return f"{normalized} >= datetime('now', ?)", [f"-{days_int} days"]


def _since_clause(since_days: int | None) -> tuple[str, list[Any]]:
    pred, params = created_at_since_sql(since_days)
    if pred is None:
        return "", []
    return f" WHERE {pred}", params


def select_telemetry_rows(
    db: Database,
    table: str,
    filters: dict[str, Any],
    *,
    name_col: str | None = None,
) -> list[dict]:
    """
    读取 llm_calls 或 tool_calls，支持 since_days / name / success / offset 过滤。

    Args:
        db: Database 实例。
        table: 表名（'llm_calls' 或 'tool_calls'）。
        filters: 过滤字典：
            - limit (int, 默认 5000)
            - offset (int, 默认 0)
            - since_days (int, 可选)
            - name (str, 可选；匹配 tool_name 或 model)
            - success (int, 可选；0 或 1)
        name_col: 显式指定 name 列名（例如 'tool_name' 或 'model'）。
    """
    if table not in ("llm_calls", "tool_calls"):
        raise ValueError(f"unsupported telemetry table: {table!r}")

    # 1. 归一化并校验基础分页
    try:
        limit = min(max(int(filters.get("limit", 5000)), 1), 10000)
        offset = max(int(filters.get("offset", 0) or 0), 0)
    except (ValueError, TypeError):
        limit, offset = 5000, 0

    clauses: list[str] = []
    params: list[Any] = []

    # 2. 拼接过滤条件
    # Name 过滤（tool_name 或 model）
    name_val = filters.get("name") or filters.get("tool_name")
    if name_val and (name_col or table == "llm_calls"):
        actual_name_col = name_col or "model"
        clauses.append(f"{actual_name_col} = ?")
        params.append(name_val)

    # Success 过滤
    success = filters.get("success")
    if success is not None:
        clauses.append("success = ?")
        params.append(1 if success else 0)

    # 可选 purpose 过滤（chat / memory_extract / …）
    purpose = filters.get("purpose")
    if purpose:
        clauses.append("purpose = ?")
        params.append(str(purpose))

    # 时间过滤（ISO-safe）
    since_pred, since_params = created_at_since_sql(filters.get("since_days"))
    if since_pred is not None:
        clauses.append(since_pred)
        params.extend(since_params)

    # 3. 组装并执行查询
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"SELECT * FROM {table}{where} ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with db.get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return [dict(r) for r in rows]


def aggregate_llm_summary(db: Database, *, days: int | None = 7) -> dict[str, Any]:
    """全窗口 LLM 汇总 —— 通过 SQL（无行数上限）。"""
    where, params = _since_clause(days)
    with db.get_db() as conn:
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total_calls,
                COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
                COALESCE(SUM(cost), 0) AS total_cost,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
                COALESCE(SUM(CASE WHEN COALESCE(success, 1) = 0 THEN 1 ELSE 0 END), 0)
                    AS failed_calls
            FROM llm_calls{where}
            """,
            params,
        ).fetchone()
    total = int(row["total_calls"] or 0)
    return {
        "total_calls": total,
        "total_prompt_tokens": int(row["total_prompt_tokens"] or 0),
        "total_completion_tokens": int(row["total_completion_tokens"] or 0),
        "total_cost": float(row["total_cost"] or 0),
        "avg_latency_ms": float(row["avg_latency_ms"] or 0),
        "failed_calls": int(row["failed_calls"] or 0),
        "sample_size": total,
        "capped": False,
    }


def aggregate_llm_by_model(db: Database, *, days: int | None = 7) -> list[dict[str, Any]]:
    """按 provider + model 分组的 LLM 汇总（无行数上限）。"""
    where, params = _since_clause(days)
    with db.get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT
                COALESCE(provider, '') AS provider,
                COALESCE(model, '') AS model,
                COUNT(*) AS total_calls,
                COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0)
                    AS total_tokens,
                COALESCE(SUM(cost), 0) AS cost,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
                COALESCE(SUM(CASE WHEN COALESCE(success, 1) = 0 THEN 1 ELSE 0 END), 0)
                    AS failed_calls
            FROM llm_calls{where}
            GROUP BY provider, model
            ORDER BY total_tokens DESC
            """,
            params,
        ).fetchall()
    return [
        {
            "provider": str(r["provider"]),
            "model": str(r["model"]),
            "total_calls": int(r["total_calls"] or 0),
            "prompt_tokens": int(r["prompt_tokens"] or 0),
            "completion_tokens": int(r["completion_tokens"] or 0),
            "total_tokens": int(r["total_tokens"] or 0),
            "cost": float(r["cost"] or 0),
            "avg_latency_ms": float(r["avg_latency_ms"] or 0),
            "failed_calls": int(r["failed_calls"] or 0),
            "capped": False,
        }
        for r in rows
    ]


def aggregate_tool_summary(db: Database, *, days: int | None = 7) -> list[dict[str, Any]]:
    """按 tool_name 分组的工具调用汇总（无行数上限）。"""
    where, params = _since_clause(days)
    with db.get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT
                COALESCE(tool_name, '') AS tool_name,
                COUNT(*) AS total_calls,
                COALESCE(SUM(CASE WHEN COALESCE(success, 1) = 0 THEN 1 ELSE 0 END), 0)
                    AS failed_calls,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
            FROM tool_calls{where}
            GROUP BY tool_name
            ORDER BY total_calls DESC
            """,
            params,
        ).fetchall()
    return [
        {
            "tool_name": str(r["tool_name"]),
            "total_calls": int(r["total_calls"] or 0),
            "failed_calls": int(r["failed_calls"] or 0),
            "avg_latency_ms": float(r["avg_latency_ms"] or 0),
            "capped": False,
        }
        for r in rows
    ]


def aggregate_call_failure_rates(db: Database, *, days: int = 1) -> dict[str, Any]:
    """LLM 与工具调用的 24h 风格失败率汇总。"""
    where, params = _since_clause(days)
    with db.get_db() as conn:
        llm = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN COALESCE(success, 1) = 0 THEN 1 ELSE 0 END), 0)
                    AS failed
            FROM llm_calls{where}
            """,
            params,
        ).fetchone()
        tool = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN COALESCE(success, 1) = 0 THEN 1 ELSE 0 END), 0)
                    AS failed
            FROM tool_calls{where}
            """,
            params,
        ).fetchone()
    llm_total = int(llm["total"] or 0)
    tool_total = int(tool["total"] or 0)
    llm_fail = int(llm["failed"] or 0)
    tool_fail = int(tool["failed"] or 0)
    return {
        "llm_total": llm_total,
        "llm_failed": llm_fail,
        "llm_failure_rate": round(llm_fail / llm_total, 4) if llm_total else 0.0,
        "tool_total": tool_total,
        "tool_failed": tool_fail,
        "tool_failure_rate": round(tool_fail / tool_total, 4) if tool_total else 0.0,
        "sample_size_llm": llm_total,
        "sample_size_tool": tool_total,
        "capped": False,
    }
