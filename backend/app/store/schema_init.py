"""统一 Schema 初始化 —— 生产库走 Alembic，测试/自定义库走 raw DDL。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.store.database import Database

logger = logging.getLogger(__name__)


def uses_alembic(db_path: str) -> bool:
    """db_path 是否为已配置的生产 SQLite 文件。"""
    from app.config import settings as live_settings

    return Path(db_path).resolve() == Path(live_settings.sqlite_path).resolve()


def apply_projection_ddl(db: Database) -> None:
    """确保 projector 拥有的投影表存在（幂等）。

    这些表归 Kernel projector 所有；生产库在 Alembic baseline 之后应用它们。
    所有列都在 CREATE 语句中声明。
    """
    from app.store.schema_ddl import (
        MEMORY_INDEX_REPAIRS_SCHEMA,
        POLICY_EVENTS_SCHEMA,
        TIMER_EVENTS_SCHEMA,
    )

    with db.get_db() as conn:
        conn.executescript(TIMER_EVENTS_SCHEMA)
        conn.executescript(POLICY_EVENTS_SCHEMA)
        conn.executescript(MEMORY_INDEX_REPAIRS_SCHEMA)


def apply_raw_ddl(db: Database) -> None:
    """对测试/自定义库应用 inline DDL（不走 Alembic）。"""
    from app.store.schema_ddl import ALL_SCHEMAS

    with db.get_db() as conn:
        for schema in ALL_SCHEMAS:
            conn.executescript(schema)


def ensure_schema(db: Database) -> None:
    """初始化 Schema：生产路径走 Alembic，其他路径走 raw DDL。"""
    if not uses_alembic(db.db_path):
        apply_raw_ddl(db)
        return

    # 生产路径：Alembic 是单一可信源。迁移失败必须中止启动 ——
    # 静默回退 raw DDL 会让生产库的 Schema 与 Alembic 产生不可见的偏离。
    from app.store.alembic_runner import run_migrations
    try:
        head = run_migrations()
    except Exception as exc:
        logger.error(
            "Alembic schema setup failed on production DB %s — refusing to "
            "fall back to raw DDL (schema divergence risk): %s",
            db.db_path,
            exc,
        )
        raise
    if head is None:
        logger.error(
            "Alembic could not initialize on production DB %s "
            "(alembic.ini missing or no head) — refusing to continue.",
            db.db_path,
        )
        raise RuntimeError(
            "Alembic schema initialization failed on production DB "
            f"{db.db_path}"
        )

    # Alembic baseline 后再幂等确保 projector 拥有的表。
    apply_projection_ddl(db)
