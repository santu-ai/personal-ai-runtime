"""SQLite 数据库管理 —— 连接池 + Schema 生命周期 + 单实例文件锁。

受治理的读会走 Kernel.query_state；本类仅负责：
  1. 连接池（线程本地、WAL 模式、busy_timeout）
  2. Schema 生命周期（构造时走 Alembic 或 raw DDL）

模块级还提供 InstanceLock（INV-W6 运行时强制）：控制面为单进程，
启动时对 ``{sqlite_path}.lock`` 加非阻塞文件锁，阻止第二个后端实例
对同一数据库双倍重放 running 执行 / 双倍触发 timer。
"""

import logging
import sqlite3
import sys
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO, Generator

from app.store.bound_proxy import BoundProxy

logger = logging.getLogger(__name__)


# ── 单实例文件锁（INV-W6：控制面单进程，运行时强制） ──────────────────────


class InstanceLockError(RuntimeError):
    """获取单实例锁失败——另一个后端实例正在使用同一数据库。"""


class InstanceLock:
    """跨平台单实例文件锁（Windows: msvcrt.locking；POSIX: fcntl.flock）。

    - 非阻塞获取：拿不到锁立即抛 InstanceLockError（清晰中文提示）。
    - 同进程重入安全：已持有时重复 acquire 为 no-op（held 状态记录在实例上）。
    - release 后可重新获取（FastAPI TestClient 反复进出 lifespan 必须稳定）。

    Windows 的 msvcrt.locking 只锁字节区间且锁随句柄，因此锁句柄在
    acquire→release 期间保持打开，release 时先解锁再关闭句柄。
    """

    def __init__(self, lock_path: str):
        self.lock_path = lock_path
        self._handle: BinaryIO | None = None

    @property
    def held(self) -> bool:
        return self._handle is not None

    def acquire(self) -> None:
        if self._handle is not None:
            return  # 同进程重入：已持有，no-op
        Path(self.lock_path).parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.lock_path, "a+b")  # noqa: SIM115 — 句柄持有到 release
        try:
            if sys.platform == "win32":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise InstanceLockError(
                f"另一个后端实例正在使用同一数据库（锁文件：{self.lock_path}）。"
                "控制面为单进程（INV-W6），请先停止已运行的实例再启动。"
            ) from exc
        self._handle = handle

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        self._handle = None
        try:
            if sys.platform == "win32":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            logger.debug("Error unlocking instance lock", exc_info=True)
        finally:
            handle.close()


# 进程内锁注册表（以锁文件路径为 key），保证同进程重复 acquire 是 no-op。
_process_locks: dict[str, InstanceLock] = {}


def _lock_path_for(db_path: str | None) -> str:
    if db_path is None:
        # 在调用期（而非 import 期）解析 settings，确保测试 reset_settings() 生效。
        from app.config import settings as live_settings

        db_path = live_settings.sqlite_path
    return f"{db_path}.lock"


def acquire_instance_lock(db_path: str | None = None) -> InstanceLock:
    """获取当前进程对 ``{sqlite_path}.lock`` 的单实例锁。

    同进程重复调用为 no-op；被其他进程持有时抛 InstanceLockError。
    """
    path = _lock_path_for(db_path)
    lock = _process_locks.get(path)
    if lock is None:
        lock = InstanceLock(path)
    lock.acquire()
    _process_locks[path] = lock
    return lock


def release_instance_lock(db_path: str | None = None) -> None:
    """释放当前进程持有的单实例锁（未持有时为 no-op）。"""
    path = _lock_path_for(db_path)
    lock = _process_locks.pop(path, None)
    if lock is not None:
        lock.release()


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

if TYPE_CHECKING:
    db: Database
else:
    db = BoundProxy()


def bind_db_factory(factory) -> None:
    """将模块级 ``db`` 绑定到 RuntimeContainer（仅由 runtime 调用）。"""
    db.bind(factory)  # type: ignore[attr-defined]
