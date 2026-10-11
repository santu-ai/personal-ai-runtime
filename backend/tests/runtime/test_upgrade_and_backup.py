"""Upgrade from the previous schema, and backup that keeps settings."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from alembic.config import Config

from alembic import command


@pytest.fixture
def pinned_db(tmp_path, monkeypatch):
    import app.config as cfg
    from app.core.runtime.runtime_config import invalidate_runtime_config_cache
    from app.core.runtime.runtime_container import runtime

    db_path = tmp_path / "personal_ai.db"
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SQLITE_PATH", str(db_path))
    monkeypatch.setenv("VECTOR_DIR", str(tmp_path / "vectors"))
    cfg.reset_settings()
    monkeypatch.setattr("app.core.runtime.runtime_config.settings", cfg.settings)
    runtime.reset()
    invalidate_runtime_config_cache()
    yield tmp_path
    invalidate_runtime_config_cache()
    runtime.reset()
    cfg.reset_settings()


def _alembic(db_path: Path) -> Config:
    ini = Path(__file__).resolve().parents[2] / "alembic.ini"
    cfg = Config(str(ini))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


def test_upgrade_from_0001_keeps_settings_and_events(pinned_db):
    db_path = pinned_db / "personal_ai.db"
    alembic_cfg = _alembic(db_path)
    command.upgrade(alembic_cfg, "0001_consolidated")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DROP INDEX IF EXISTS ux_notifications_dedup_key")
        conn.execute(
            "INSERT INTO app_settings (category, data_json) VALUES (?, ?)",
            ("email", json.dumps({"user": "trial@example.com", "password": "app-pass"})),
        )
        conn.execute(
            """INSERT INTO event_log
               (id, type, aggregate_type, aggregate_id, actor, payload)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                "evt-trial",
                "WorkItemCreated",
                "work_item",
                "w-trial",
                "user",
                json.dumps({"title": "试用项目"}),
            ),
        )
        conn.execute(
            """INSERT INTO notifications (id, type, title, content, dedup_key)
               VALUES (?, ?, ?, ?, ?)""",
            ("n1", "alert", "第一次", "试用提醒", "trial-dedup"),
        )
        conn.execute(
            """INSERT INTO notifications (id, type, title, content, dedup_key)
               VALUES (?, ?, ?, ?, ?)""",
            ("n2", "alert", "重复", "试用提醒", "trial-dedup"),
        )
        conn.commit()
    finally:
        conn.close()

    command.upgrade(alembic_cfg, "head")

    conn = sqlite3.connect(db_path)
    try:
        version = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
        email = json.loads(
            conn.execute(
                "SELECT data_json FROM app_settings WHERE category = 'email'"
            ).fetchone()[0]
        )
        event = conn.execute(
            "SELECT payload FROM event_log WHERE id = 'evt-trial'"
        ).fetchone()
        notes = conn.execute(
            "SELECT id, title FROM notifications WHERE dedup_key = 'trial-dedup' ORDER BY rowid"
        ).fetchall()
    finally:
        conn.close()

    assert version == "0002_notification_dedup"
    assert email["user"] == "trial@example.com"
    assert email["password"] == "app-pass"
    assert json.loads(event[0])["title"] == "试用项目"
    assert notes == [("n1", "第一次")]


def test_database_backup_omits_the_settings_key(pinned_db):
    from app.core.runtime import runtime_config as keymod
    from app.core.runtime.runtime_config import RuntimeConfig, invalidate_runtime_config_cache
    from app.core.runtime.runtime_container import runtime

    rc = RuntimeConfig()
    rc.update_email_config({"user": "trial@example.com", "password": "app-pass"})
    key = pinned_db / "settings.key"
    body = key.read_text(encoding="utf-8")
    lines = body.splitlines()
    assert lines[0] == "os:v1"
    assert lines[1] in {"process", "dpapi", "keychain", "libsecret"}
    secret = keymod._PROCESS_KEYS.get(lines[2] if len(lines) > 2 else "")

    dest = pinned_db / "backup"
    copied = runtime.db.backup_to(dest)
    db_copy = dest / "personal_ai.db"
    assert Path(str(copied["database"])).is_file()
    assert copied["settings_key"] is False
    assert not (dest / "settings.key").exists()
    if secret is not None:
        assert secret not in key.read_bytes()
        assert secret not in db_copy.read_bytes()

    rc.update_email_config({"user": "trial@example.com", "password": "changed"})
    (dest / "settings.key").write_bytes(b"stolen-raw-key\n")
    invalidate_runtime_config_cache()
    runtime.db.restore_from(dest)
    invalidate_runtime_config_cache()

    assert rc.get_email_credentials()["password"] == "app-pass"
    assert key.read_text(encoding="utf-8") == body
    assert b"stolen-raw-key" not in key.read_bytes()


def test_encrypted_export_roundtrips_settings(pinned_db):
    from app.api.system import _apply_imported_settings, _settings_for_export
    from app.core.runtime.runtime_config import RuntimeConfig, invalidate_runtime_config_cache
    from app.product.encrypted_sync import decrypt_snapshot_sync, encrypt_snapshot_sync

    rc = RuntimeConfig()
    rc.update_email_config({"user": "trial@example.com", "password": "app-pass"})
    blob = encrypt_snapshot_sync(
        {"format": "event_log_v1", "event_log": [], "app_settings": _settings_for_export()},
        "correct horse",
    )
    rc.update_email_config({"user": "trial@example.com", "password": "changed"})
    invalidate_runtime_config_cache()
    restored = decrypt_snapshot_sync(blob, "correct horse")
    assert _apply_imported_settings(restored["app_settings"]) is True
    invalidate_runtime_config_cache()
    assert rc.get_email_credentials()["password"] == "app-pass"
