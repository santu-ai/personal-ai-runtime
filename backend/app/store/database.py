"""SQLite 数据库管理 —— 连接池 + Schema 生命周期。

受治理的读会走 Kernel.query_state；本类仅负责：
  1. 连接池（线程本地、WAL 模式、busy_timeout）
  2. Schema 生命周期（构造时走 Alembic 或 raw DDL）
"""

import logging
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Generator

from app.store.bound_proxy import BoundProxy

logger = logging.getLogger(__name__)
# 每个 Database 路径在线程内独占一个 SQLite 连接，跨 get_db() 复用，close() 时释放。
# 以 db_path 为 key 是为了阻止测试中不同 Database 复用同一连接。
_tls = threading.local()


def _tls_connections() -> dict[str, sqlite3.Connection]:
    """返回当前线程的连接字典（不存在则创建）。"""
    d = getattr(_tls, "connections", None)
    if d is None:
        d = {}
        _tls.connections = d
    return d


class Database:
    def __init__(self, db_path: str | None = None):
        # 在构造期（而非 import 期）解析 settings，确保测试 reset_settings() 生效。
        from app.config import settings as live_settings

        self.db_path = db_path or live_settings.sqlite_path
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()
        # 持久化 pragma 仅需对每个 DB 文件执行一次（WAL 模式是 DB 属性）。
        self._ensure_wal_pragmas()

    def _ensure_wal_pragmas(self) -> None:
        """应用一次性持久 pragma（写入 DB 文件头）。"""
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            # WAL + NORMAL synchronous：WAL 自身保证持久性，每次 commit fsync 是多余开销。
            conn.execute("PRAGMA synchronous=NORMAL")
        finally:
            conn.close()

    def _init_schema(self) -> None:
        """经统一入口确保 Schema（生产库走 Alembic，其余走 raw DDL）。"""
        from app.store.schema_init import ensure_schema

        ensure_schema(self)

    def _setup_connection(self, conn: sqlite3.Connection) -> sqlite3.Connection:
        """对新建连接应用标准配置。"""
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _get_connection(self) -> sqlite3.Connection:
        # 检查当前线程是否已为该 db_path 持有连接。
        connections = _tls_connections()
        conn = connections.get(self.db_path)
        if conn is None:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            self._setup_connection(conn)
            connections[self.db_path] = conn
        return conn

    def close(self):
        """关闭当前线程内对应 db_path 的连接（如有）。"""
        connections = _tls_connections()
        conn = connections.pop(self.db_path, None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                logger.debug("Error closing database connection", exc_info=True)

    @contextmanager
    def get_db(self) -> Generator[sqlite3.Connection, None, None]:
        conn = self._get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            logger.exception("Database transaction rolled back")
            conn.rollback()
            raise
        except BaseException:
            # GeneratorExit / KeyboardInterrupt 不是 Exception 的子类。
            # 这里仍要 rollback，避免 TLS 连接保留一个未结束的 BEGIN，
            # 导致后续复用时拿到过期的 WAL 快照。
            try:
                conn.rollback()
            except Exception:
                logger.debug("Error rolling back after GeneratorExit", exc_info=True)
            raise
        # 连接保持打开以便复用；只在显式 close() 时关闭。

    def get_raw_connection(self) -> sqlite3.Connection:
        """返回一个**全新的、独立的**连接（不来自 TLS 池）。

        调用方需要自行管理 .commit() / .rollback() / .close()。
        仅用于长时间原子操作 —— 这类操作不能共享线程本地的 transaction scope
        （例如 import_event_log_rows）。
        """
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        return self._setup_connection(conn)

    # --- WAL checkpoint：周期性调用，避免 -wal 旁挂文件无限增长 ---

    def wal_checkpoint(self, mode: str = "PASSIVE") -> None:
        """执行 WAL checkpoint 以截断 -wal 旁挂文件。

        PASSIVE 模式可在任意时刻安全调用，不阻塞读写。
        """
        # 白名单模式以防止 SQL 注入并确保 PRAGMA 合法。
        allowed_modes = {"PASSIVE", "FULL", "RESTART", "TRUNCATE"}
        mode_upper = mode.upper()
        if mode_upper not in allowed_modes:
            raise ValueError(f"Invalid WAL checkpoint mode: {mode}. Must be one of {allowed_modes}")

        conn = self._get_connection()
        try:
            conn.execute(f"PRAGMA wal_checkpoint({mode_upper})")
        except Exception:
            logger.debug("WAL checkpoint failed", exc_info=True)

    # --- 活动日志（APP_STORAGE，非受治理） ---

    def log_activity(self, activity_type: str, payload: str | None = None):
        with self.get_db() as conn:
            conn.execute(
                "INSERT INTO activity_log (type, payload) VALUES (?, ?)",
                (activity_type, payload),
            )


if TYPE_CHECKING:
    db: Database
else:
    db = BoundProxy()


def bind_db_factory(factory) -> None:
    """将模块级 ``db`` 绑定到 RuntimeContainer（仅由 runtime 调用）。"""
    db.bind(factory)  # type: ignore[attr-defined]
