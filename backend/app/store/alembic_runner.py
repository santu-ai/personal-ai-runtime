"""Alembic Schema 执行器 —— 应用启动时调用以初始化 DB Schema。"""

import logging
import os
from pathlib import Path
from typing import Optional

from alembic.config import Config
from alembic.script import ScriptDirectory

from alembic import command

logger = logging.getLogger(__name__)


def _find_alembic_ini() -> Path:
    """按多策略回退定位 alembic.ini。"""
    strategies = [
        # 策略 1：环境变量
        lambda: Path(os.environ.get("ALEMBIC_CONFIG", "")),
        # 策略 2：相对于本文件（backend/app/store/alembic_runner.py）
        lambda: Path(__file__).resolve().parent.parent.parent / "alembic.ini",
        # 策略 3：当前工作目录
        lambda: Path.cwd() / "alembic.ini",
        # 策略 4：CWD 下的 backend 子目录
        lambda: Path.cwd() / "backend" / "alembic.ini",
    ]

    for strategy in strategies:
        try:
            path = strategy()
            if path.is_file():
                return path
        except Exception:
            logger.debug("alembic.ini strategy failed", exc_info=True)
            continue

    # 默认回退（可能不存在，将由 run_migrations 捕获处理）
    return Path(__file__).resolve().parent.parent.parent / "alembic.ini"


_ALEMBIC_INI = _find_alembic_ini()


def run_migrations(db_url: Optional[str] = None) -> Optional[str]:
    """将 Alembic Schema 升级到 head（幂等，可每次启动调用）。

    Args:
        db_url: 可选的 SQLAlchemy DB URL，用于覆盖默认配置。

    Returns:
        迁移完成后的当前 head revision ID。
    """
    if not _ALEMBIC_INI.is_file():
        logger.warning("alembic.ini not found at %s — skipping schema setup", _ALEMBIC_INI)
        return None

    # 防御性默认值：某些 app model 在 import 时会读取 LLM_API_KEY，缺失会崩。
    os.environ.setdefault("LLM_API_KEY", "alembic-migration-key")

    alembic_cfg = Config(str(_ALEMBIC_INI))
    if db_url:
        alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    try:
        command.upgrade(alembic_cfg, "head")

        # 记录并返回当前 head，便于可观测性
        script = ScriptDirectory.from_config(alembic_cfg)
        head_rev = script.get_current_head()

        target = f" to {db_url}" if db_url else ""
        logger.info("Alembic schema applied successfully (head: %s)%s", head_rev, target)
        return head_rev
    except Exception as exc:
        logger.error("Alembic schema setup failed on %s: %s", _ALEMBIC_INI, exc)
        raise
