"""Tests for runtime configuration storage."""

import json
from pathlib import Path

import pytest

from app.core.runtime.runtime_config import (
    _MASKED_SECRET,
    invalidate_runtime_config_cache,
)


@pytest.fixture
def isolated_runtime_config(tmp_path, monkeypatch):
    """Pin SQLITE_PATH to tmp so updates cannot land in the day-to-day DB.

    DATA_DIR alone is not enough: a non-empty SQLITE_PATH in .env still wins.
    runtime.reset() drops any Database bound before the path change.
    """
    import app.config as cfg
    from app.core.runtime.runtime_container import runtime

    db_path = str(tmp_path / "personal_ai.db")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SQLITE_PATH", db_path)
    monkeypatch.setenv("VECTOR_DIR", str(tmp_path / "vectors"))
    cfg.reset_settings()
    monkeypatch.setattr("app.core.runtime.runtime_config.settings", cfg.settings)
    runtime.reset()
    invalidate_runtime_config_cache()
    yield tmp_path


def test_isolated_runtime_config_uses_tmp_sqlite(isolated_runtime_config):
    from app.config import settings
    from app.core.runtime.runtime_container import runtime

    tmp = isolated_runtime_config.resolve()
    assert Path(settings.sqlite_path).resolve().is_relative_to(tmp)
    assert Path(runtime.db.db_path).resolve().is_relative_to(tmp)


def test_default_llm_config_from_env(isolated_runtime_config, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "deepseek-chat")
    import app.config as cfg

    cfg.reset_settings()
    monkeypatch.setattr("app.core.runtime.runtime_config.settings", cfg.settings)
    invalidate_runtime_config_cache()
    from app.core.runtime.runtime_config import RuntimeConfig

    llm = RuntimeConfig().get_llm_config(masked=False)
    assert llm["default_provider"] == "deepseek"
    assert any(p["id"] == "deepseek" for p in llm["providers"])


def test_update_llm_masks_api_key(isolated_runtime_config):
    from app.core.runtime.runtime_config import RuntimeConfig

    rc = RuntimeConfig()
    rc.update_llm_config({
        "providers": [{
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai_compatible",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "secret-key-123",
            "enabled": True,
        }],
    })
    masked = rc.get_llm_config(masked=True)
    assert masked["providers"][0]["api_key"] == _MASKED_SECRET
    assert masked["providers"][0]["has_api_key"] is True


def test_update_llm_preserves_key_when_masked(isolated_runtime_config):
    from app.core.runtime.runtime_config import RuntimeConfig

    rc = RuntimeConfig()
    rc.update_llm_config({
        "providers": [{
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai_compatible",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "keep-this-key",
            "enabled": True,
        }],
    })
    rc.update_llm_config({
        "providers": [{
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai_compatible",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": _MASKED_SECRET,
            "enabled": True,
        }],
    })
    raw = rc.get_llm_config(masked=False)
    assert raw["providers"][0]["api_key"] == "keep-this-key"


def test_update_email_config(isolated_runtime_config):
    from app.core.runtime.runtime_config import RuntimeConfig

    rc = RuntimeConfig()
    result = rc.update_email_config({
        "user": "test@gmail.com",
        "password": "app-password",
    })
    assert result["user"] == "test@gmail.com"
    assert result["password"] == _MASKED_SECRET

    creds = rc.get_email_credentials()
    assert creds["user"] == "test@gmail.com"
    assert creds["password"] == "app-password"


def test_effective_api_key_falls_back_to_env(monkeypatch):
    monkeypatch.setattr(
        "app.core.runtime.runtime_config.settings.llm_api_key",
        "real-env-key-from-dotenv",
    )
    from app.core.runtime.runtime_config import effective_api_key

    provider = {
        "id": "deepseek",
        "type": "openai_compatible",
        "api_key": "test-key",
    }
    assert effective_api_key(provider) == "real-env-key-from-dotenv"
    assert effective_api_key({**provider, "api_key": "sk-user-key"}) == "sk-user-key"


def test_config_persisted_to_db(isolated_runtime_config):
    from app.core.runtime.runtime_config import RuntimeConfig
    from app.store.database import db

    rc = RuntimeConfig()
    rc.update_email_config({
        "user": "persist@gmail.com",
        "password": "secret",
    })
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM app_settings WHERE category = 'email'"
        ).fetchone()
    assert row is not None
    data = json.loads(row["data_json"])
    assert data["user"] == "persist@gmail.com"
    assert data["password"] != "secret"
    assert str(data["password"]).startswith("enc:v1:")
    assert "secret" not in row["data_json"]
    key_path = isolated_runtime_config / "settings.key"
    assert key_path.is_file()
    assert key_path.stat().st_mode & 0o777 == 0o600
    assert key_path.read_text(encoding="utf-8").startswith("os:v1\n")
    assert "secret" not in key_path.read_text(encoding="utf-8")
    assert rc.get_email_credentials()["password"] == "secret"


def test_legacy_plaintext_secret_is_sealed_on_read(isolated_runtime_config):
    from app.core.runtime.runtime_config import RuntimeConfig
    from app.store.database import db

    rc = RuntimeConfig()
    rc.update_email_config({
        "user": "legacy@gmail.com",
        "password": "first",
    })
    legacy = {
        "provider": "gmail",
        "user": "legacy@gmail.com",
        "password": "secret-legacy",
        "imap_host": "imap.gmail.com",
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
    }
    with db.get_db() as conn:
        conn.execute(
            "UPDATE app_settings SET data_json = ? WHERE category = 'email'",
            (json.dumps(legacy),),
        )
    invalidate_runtime_config_cache()
    assert rc.get_email_credentials()["password"] == "secret-legacy"
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM app_settings WHERE category = 'email'"
        ).fetchone()
    assert "secret-legacy" not in row["data_json"]
    assert "enc:v1:" in row["data_json"]
    invalidate_runtime_config_cache()
    assert rc.get_email_credentials()["password"] == "secret-legacy"


def test_llm_api_key_is_sealed_in_the_database(isolated_runtime_config):
    from app.core.runtime.runtime_config import RuntimeConfig
    from app.store.database import db

    rc = RuntimeConfig()
    rc.update_llm_config({
        "providers": [{
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai_compatible",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "secret-key-123",
            "enabled": True,
        }],
    })
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM app_settings WHERE category = 'llm'"
        ).fetchone()
    assert "secret-key-123" not in row["data_json"]
    assert "enc:v1:" in row["data_json"]
    stored = rc.get_llm_config(masked=False)
    assert stored["providers"][0]["api_key"] == "secret-key-123"


def test_legacy_raw_key_file_is_wrapped_and_still_opens(isolated_runtime_config):
    from cryptography.fernet import Fernet

    from app.core.runtime.runtime_config import RuntimeConfig
    from app.store.database import db

    key = Fernet.generate_key()
    sealed = "enc:v1:" + Fernet(key).encrypt(b"app-pass").decode()
    key_path = isolated_runtime_config / "settings.key"
    key_path.write_bytes(key + b"\n")
    with db.get_db() as conn:
        conn.execute(
            "INSERT INTO app_settings (category, data_json) VALUES (?, ?)",
            ("email", json.dumps({"user": "trial@example.com", "password": sealed})),
        )
    assert RuntimeConfig().get_email_credentials()["password"] == "app-pass"
    body = key_path.read_text(encoding="utf-8")
    assert body.startswith("os:v1\n")
    assert key.decode() not in body


def test_electron_wrapped_key_stays_sealed_without_the_desktop(isolated_runtime_config):
    from cryptography.fernet import Fernet

    from app.core.runtime.runtime_config import RuntimeConfig
    from app.store.database import db

    key = Fernet.generate_key()
    sealed = "enc:v1:" + Fernet(key).encrypt(b"app-pass").decode()
    key_path = isolated_runtime_config / "settings.key"
    key_path.write_text("os:v1\nelectron\nAAAA\n", encoding="utf-8")
    with db.get_db() as conn:
        conn.execute(
            "INSERT INTO app_settings (category, data_json) VALUES (?, ?)",
            ("email", json.dumps({"user": "a@b.c", "password": sealed})),
        )
    assert RuntimeConfig().get_email_credentials()["password"] != "app-pass"
    assert key_path.read_text(encoding="utf-8").startswith("os:v1\nelectron\n")
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM app_settings WHERE category = 'email'"
        ).fetchone()
    assert "app-pass" not in row["data_json"]
