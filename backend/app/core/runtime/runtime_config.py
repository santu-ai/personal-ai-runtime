"""Runtime configuration — LLM and email settings persisted in SQLite.

Env vars seed defaults on first load; UI edits are stored in app_settings table.
If runtime_config.json exists, it is imported into app_settings on first read.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import shutil
import subprocess
import sys
import threading
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.core.runtime import kernel_instance as _kernel_module
from app.core.runtime.runtime_container import _LazyProxy, runtime
from app.store.database import db

logger = logging.getLogger(__name__)

_CONFIG_FILENAME = "runtime_config.json"
_lock = threading.Lock()
_MASKED_SECRET = "••••••••"
_SEAL_PREFIX = "enc:v1:"
_KEY_HEADER = "os:v1\n"
_cache: dict[str, Any] | None = None
_FERNET: Fernet | None = None
_FERNET_PATH: str | None = None
_PROCESS_KEYS: dict[str, bytes] = {}
_ELECTRON_KEY: bytes | None = None
_ELECTRON_FD_READ = False

# Provider type → connection semantics (all use OpenAI SDK today).
PROVIDER_TYPES = {
    "openai_compatible": {
        "label": "OpenAI 兼容",
        "description": "DeepSeek、OpenAI、Ollama 及各类兼容代理",
        "requires_api_key": True,
    },
    "ollama": {
        "label": "Ollama 本地",
        "description": "本地 Ollama，API Key 可填 ollama",
        "requires_api_key": False,
    },
}

PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "deepseek": {
        "name": "DeepSeek",
        "type": "openai_compatible",
        "base_url": "https://api.deepseek.com/v1",
        "model": "deepseek-chat",
    },
    "openai": {
        "name": "OpenAI",
        "type": "openai_compatible",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "anthropic": {
        "name": "Anthropic (兼容代理)",
        "type": "openai_compatible",
        "base_url": "https://api.anthropic.com/v1",
        "model": "claude-sonnet-4-20250514",
    },
    "ollama": {
        "name": "Ollama",
        "type": "ollama",
        "base_url": "http://localhost:11434/v1",
        "model": "qwen2.5:7b",
    },
}

GMAIL_DEFAULTS = {
    "provider": "gmail",
    "imap_host": "imap.gmail.com",
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 465,
}


def _config_path() -> Path:
    return Path(settings.data_dir) / _CONFIG_FILENAME


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    return _MASKED_SECRET


_PLACEHOLDER_API_KEYS = frozenset({"", "test-key", "keep-this-key", "ollama"})


def _env_api_key_for_provider(provider_id: str) -> str:
    """Read API key from environment for known provider ids."""
    env_map = {
        "deepseek": settings.llm_api_key,
        "openai": os.getenv("OPENAI_API_KEY", ""),
        "anthropic": os.getenv("ANTHROPIC_API_KEY", ""),
    }
    return env_map.get(provider_id, "")


def effective_api_key(provider: dict[str, Any]) -> str:
    """Resolve API key: DB value wins, else fall back to .env for known providers."""
    ptype = provider.get("type", "openai_compatible")
    stored = (provider.get("api_key") or "").strip()
    if ptype == "ollama":
        return stored or "ollama"
    if stored and stored not in _PLACEHOLDER_API_KEYS:
        return stored
    env_key = _env_api_key_for_provider(provider.get("id", ""))
    return env_key or stored


def is_masked(value: str | None) -> bool:
    """Return True when *value* is a UI-masked secret placeholder (not a real secret)."""
    return value == _MASKED_SECRET or (value or "").startswith("••••")


def _default_llm_from_env() -> dict[str, Any]:
    providers: list[dict[str, Any]] = [
        {
            "id": "deepseek",
            "name": "DeepSeek",
            "type": "openai_compatible",
            "base_url": settings.llm_base_url,
            "model": settings.llm_model,
            "api_key": settings.llm_api_key,
            "enabled": True,
        }
    ]

    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key:
        providers.append({
            "id": "openai",
            "name": "OpenAI",
            "type": "openai_compatible",
            "base_url": "https://api.openai.com/v1",
            "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "api_key": openai_key,
            "enabled": True,
        })

    claude_key = os.getenv("ANTHROPIC_API_KEY", "")
    if claude_key:
        providers.append({
            "id": "anthropic",
            "name": "Anthropic",
            "type": "openai_compatible",
            "base_url": os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
            "model": os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
            "api_key": claude_key,
            "enabled": True,
        })

    ollama_url = os.getenv("OLLAMA_BASE_URL", "") or settings.ollama_base_url
    if ollama_url:
        providers.append({
            "id": "ollama",
            "name": "Ollama",
            "type": "ollama",
            "base_url": ollama_url,
            "model": os.getenv("OLLAMA_MODEL", settings.ollama_model),
            "api_key": "ollama",
            "enabled": True,
        })

    return {
        "default_provider": "deepseek",
        "temperature": settings.llm_temperature,
        "max_tokens": settings.llm_max_tokens,
        "providers": providers,
    }


def _default_email_from_env() -> dict[str, Any]:
    return {
        **GMAIL_DEFAULTS,
        "user": settings.email_user,
        "password": settings.email_pass,
    }



class SettingsKeyUnavailable(RuntimeError):
    """The Fernet key is not available in this process."""


def _settings_key_path() -> Path:
    return Path(settings.sqlite_path).resolve().parent / "settings.key"


def _key_service() -> str:
    digest = hashlib.sha256(str(_settings_key_path()).encode()).hexdigest()[:16]
    return f"personal-ai-runtime-{digest}"


def _backend_name() -> str:
    """OS store when this machine has one. Otherwise the key stays in memory.

    Electron safeStorage uses the same OS facilities (DPAPI, login keychain,
    libsecret). A backend that is not the desktop app calls them directly.
    Without any of them, nothing on disk can open enc:v1 after this process exits.
    """
    forced = os.environ.get("PAR_SETTINGS_KEY_BACKEND", "").strip()
    if forced in {"process", "dpapi", "keychain", "libsecret"}:
        return forced
    if sys.platform == "win32":
        return "dpapi"
    if sys.platform == "darwin":
        return "keychain"
    if shutil.which("secret-tool"):
        return "libsecret"
    return "process"


def _write_key_file(body: str) -> None:
    path = _settings_key_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("settings.key.tmp")
    tmp.write_text(body, encoding="utf-8")
    try:
        tmp.chmod(0o600)
    except OSError:
        logger.warning("could not restrict settings key file mode")
    tmp.replace(path)


def _dpapi_protect(data: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    buf = ctypes.create_string_buffer(data)
    blob_in = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    blob_out = DATA_BLOB()
    crypt32 = getattr(ctypes, "windll").crypt32
    if not crypt32.CryptProtectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out),
    ):
        raise OSError("CryptProtectData failed")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        getattr(ctypes, "windll").kernel32.LocalFree(blob_out.pbData)


def _dpapi_unprotect(data: bytes) -> bytes:
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    buf = ctypes.create_string_buffer(data)
    blob_in = DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    blob_out = DATA_BLOB()
    crypt32 = getattr(ctypes, "windll").crypt32
    if not crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out),
    ):
        raise OSError("CryptUnprotectData failed")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        getattr(ctypes, "windll").kernel32.LocalFree(blob_out.pbData)


def _run_secret(args: list[str], *, input_bytes: bytes | None = None) -> bytes:
    try:
        completed = subprocess.run(
            args,
            input=input_bytes,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SettingsKeyUnavailable("os key store") from exc
    return completed.stdout


def _keychain_store(key: bytes) -> None:
    _run_secret([
        "security", "add-generic-password", "-U",
        "-s", _key_service(), "-a", "settings", "-w", key.decode(),
    ])


def _keychain_load() -> bytes:
    return _run_secret([
        "security", "find-generic-password",
        "-s", _key_service(), "-a", "settings", "-w",
    ]).strip()


def _libsecret_store(key: bytes) -> None:
    _run_secret(
        [
            "secret-tool", "store",
            "--label=personal-ai-runtime settings",
            "service", _key_service(),
            "account", "settings",
        ],
        input_bytes=key + b"\n",
    )


def _libsecret_load() -> bytes:
    return _run_secret([
        "secret-tool", "lookup",
        "service", _key_service(),
        "account", "settings",
    ]).strip()


def _protect(backend: str, key: bytes) -> str:
    if backend == "process":
        ident = secrets.token_hex(16)
        _PROCESS_KEYS[ident] = key
        return f"{_KEY_HEADER}process\n{ident}\n"
    if backend == "dpapi":
        blob = base64.b64encode(_dpapi_protect(key)).decode()
        return f"{_KEY_HEADER}dpapi\n{blob}\n"
    if backend == "keychain":
        _keychain_store(key)
        return f"{_KEY_HEADER}keychain\n"
    if backend == "libsecret":
        _libsecret_store(key)
        return f"{_KEY_HEADER}libsecret\n"
    raise SettingsKeyUnavailable(backend)


def _store_key(key: bytes) -> None:
    backend = _backend_name()
    try:
        body = _protect(backend, key)
    except SettingsKeyUnavailable:
        if backend == "process":
            raise
        logger.warning("OS key store unavailable; the key stays in process memory")
        body = _protect("process", key)
    if key.decode() in body:
        raise SettingsKeyUnavailable("key file still holds the raw key")
    _write_key_file(body)


def _read_electron_fd() -> bytes | None:
    global _ELECTRON_FD_READ, _ELECTRON_KEY
    if _ELECTRON_FD_READ:
        return _ELECTRON_KEY
    _ELECTRON_FD_READ = True
    raw_fd = os.environ.pop("PAR_SETTINGS_KEY_FD", "").strip()
    if not raw_fd:
        return None
    fd = int(raw_fd)
    chunks: list[bytes] = []
    total = 0
    try:
        while total < 512:
            piece = os.read(fd, 256)
            if not piece:
                break
            chunks.append(piece)
            total += len(piece)
    finally:
        os.close(fd)
    key = b"".join(chunks).strip()
    if not key:
        return None
    _ELECTRON_KEY = key
    return key


def _unwrap(text: str, handed: bytes | None) -> bytes:
    lines = text.splitlines()
    scheme = lines[1] if len(lines) > 1 else ""
    payload = lines[2] if len(lines) > 2 else ""
    if scheme == "electron":
        if not handed:
            raise SettingsKeyUnavailable("desktop")
        return handed
    if scheme == "process":
        try:
            return _PROCESS_KEYS[payload]
        except KeyError as exc:
            raise SettingsKeyUnavailable("process") from exc
    if scheme == "dpapi":
        return _dpapi_unprotect(base64.b64decode(payload))
    if scheme == "keychain":
        return _keychain_load()
    if scheme == "libsecret":
        return _libsecret_load()
    raise SettingsKeyUnavailable(scheme or "empty")


def _fernet() -> Fernet:
    """Open the Fernet key. The raw key is not left next to the database."""
    global _FERNET, _FERNET_PATH
    path = _settings_key_path()
    path_key = str(path)
    if _FERNET is not None and _FERNET_PATH == path_key:
        return _FERNET
    handed = _read_electron_fd()
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        if text.startswith(_KEY_HEADER):
            key = _unwrap(text, handed)
        else:
            key = text.strip().encode()
            Fernet(key)
            _store_key(key)
    else:
        key = handed or Fernet.generate_key()
        _store_key(key)
    fernet = Fernet(key.strip())
    _FERNET = fernet
    _FERNET_PATH = path_key
    return fernet


def _open_secret(value: Any) -> tuple[Any, bool]:
    """Return plaintext and whether a legacy plaintext value still needs sealing."""
    if not isinstance(value, str) or not value:
        return value, False
    if not value.startswith(_SEAL_PREFIX):
        return value, True
    try:
        plain = _fernet().decrypt(value[len(_SEAL_PREFIX):].encode()).decode()
    except (InvalidToken, ValueError, SettingsKeyUnavailable):
        logger.warning("stored setting could not be opened")
        return value, False
    return plain, False


def _seal_secret(value: Any) -> Any:
    if not isinstance(value, str) or not value or value.startswith(_SEAL_PREFIX):
        return value
    try:
        fernet = _fernet()
    except SettingsKeyUnavailable:
        fernet = _install_fresh_key()
    token = fernet.encrypt(value.encode()).decode()
    return _SEAL_PREFIX + token


def _install_fresh_key() -> Fernet:
    """Start a new key when the previous one cannot be opened. Disk never gets the raw key."""
    global _FERNET, _FERNET_PATH
    key = Fernet.generate_key()
    _store_key(key)
    fernet = Fernet(key)
    _FERNET = fernet
    _FERNET_PATH = str(_settings_key_path())
    return fernet


def _open_email(email: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    out = deepcopy(email)
    opened, dirty = _open_secret(out.get("password", ""))
    out["password"] = opened
    return out, dirty


def _open_llm(llm: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    out = deepcopy(llm)
    dirty = False
    providers = []
    for provider in out.get("providers") or []:
        if not isinstance(provider, dict):
            providers.append(provider)
            continue
        item = dict(provider)
        opened, changed = _open_secret(item.get("api_key", ""))
        item["api_key"] = opened
        dirty = dirty or changed
        providers.append(item)
    out["providers"] = providers
    return out, dirty


def _seal_email(email: dict[str, Any]) -> dict[str, Any]:
    out = deepcopy(email)
    out["password"] = _seal_secret(out.get("password", ""))
    return out


def _seal_llm(llm: dict[str, Any]) -> dict[str, Any]:
    out = deepcopy(llm)
    providers = []
    for provider in out.get("providers") or []:
        if not isinstance(provider, dict):
            providers.append(provider)
            continue
        item = dict(provider)
        item["api_key"] = _seal_secret(item.get("api_key", ""))
        providers.append(item)
    out["providers"] = providers
    return out


def _persist_sealed_category(category: str, payload: dict[str, Any]) -> None:
    now = datetime.now(UTC).isoformat()
    with db.get_db() as conn:
        conn.execute(
            """INSERT INTO app_settings (category, data_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET
                 data_json = excluded.data_json,
                 updated_at = excluded.updated_at""",
            (category, json.dumps(payload, ensure_ascii=False), now),
        )


def _defaults() -> dict[str, Any]:
    return {
        "llm": _default_llm_from_env(),
        "email": _default_email_from_env(),
    }


def _read_category(conn, category: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT data_json FROM app_settings WHERE category = ?",
        (category,),
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["data_json"])
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("Invalid app_settings JSON for %s: %s", category, exc)
        return None


def _load_from_db() -> dict[str, Any] | None:
    try:
        with db.get_db() as conn:
            llm = _read_category(conn, "llm")
            email = _read_category(conn, "email")
        if llm is None and email is None:
            return None
        defaults = _defaults()
        email_dirty = False
        llm_dirty = False
        if isinstance(email, dict):
            email, email_dirty = _open_email(email)
        if isinstance(llm, dict):
            llm, llm_dirty = _open_llm(llm)
        if email_dirty and isinstance(email, dict):
            _persist_sealed_category("email", _seal_email(email))
        if llm_dirty and isinstance(llm, dict):
            _persist_sealed_category("llm", _seal_llm(llm))
        return {
            "llm": llm if llm is not None else defaults["llm"],
            "email": email if email is not None else defaults["email"],
        }
    except Exception as exc:
        logger.warning("Failed to load app_settings from DB: %s", exc)
        return None


def _load_from_json_file() -> dict[str, Any] | None:
    path = _config_path()
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        defaults = _defaults()
        if "llm" not in data:
            data["llm"] = defaults["llm"]
        if "email" not in data:
            data["email"] = defaults["email"]
        return data
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to load runtime_config.json: %s", exc)
        return None


def _load_raw(*, force: bool = False) -> dict[str, Any]:
    global _cache
    if _cache is not None and not force:
        return deepcopy(_cache)

    data = _load_from_db()
    if data is not None:
        _cache = deepcopy(data)
        return deepcopy(data)

    imported = _load_from_json_file()
    if imported is not None:
        _save_raw(imported)
        logger.info("Imported runtime_config.json into app_settings table")
        return deepcopy(_cache)  # type: ignore[arg-type]

    data = _defaults()
    _cache = deepcopy(data)
    return deepcopy(data)


def _save_raw(data: dict[str, Any]) -> None:
    global _cache
    now = datetime.now(UTC).isoformat()
    with db.get_db() as conn:
        sealed = {
            "llm": _seal_llm(data["llm"]),
            "email": _seal_email(data["email"]),
        }
        for category in ("llm", "email"):
            conn.execute(
                """INSERT INTO app_settings (category, data_json, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(category) DO UPDATE SET
                     data_json = excluded.data_json,
                     updated_at = excluded.updated_at""",
                (category, json.dumps(sealed[category], ensure_ascii=False), now),
            )
    _cache = deepcopy(data)
    # B2: emit audit event to event_log for config change traceability
    try:
        for category in ("llm", "email"):
            _kernel_module.kernel.emit_event(
                "AppConfigChanged",
                "app_config",
                category,
                payload={
                    "category": category,
                    "updated_at": now,
                },
                actor="user",
            )
    except Exception:
        logger.warning("Failed to emit AppConfigChanged audit event", exc_info=True)


def invalidate_runtime_config_cache() -> None:
    """Clear in-memory cache (tests / forced reload)."""
    global _cache, _FERNET, _FERNET_PATH
    _cache = None
    _FERNET = None
    _FERNET_PATH = None
    try:
        from app.chat.prompt_artifact import invalidate_prompt_artifact_cache

        invalidate_prompt_artifact_cache()
    except Exception:
        logger.debug("Failed to invalidate prompt artifact cache", exc_info=True)


class RuntimeConfig:
    """Thread-safe runtime configuration store."""

    @staticmethod
    def _apply_llm_mask(llm: dict[str, Any]) -> dict[str, Any]:
        masked = deepcopy(llm)
        for p in masked.get("providers", []):
            raw_key = effective_api_key(p)
            p["has_api_key"] = bool(raw_key)
            p["api_key"] = _mask_secret(raw_key)
        return masked

    @staticmethod
    def _apply_email_mask(email_cfg: dict[str, Any]) -> dict[str, Any]:
        masked = deepcopy(email_cfg)
        raw_pass = masked.get("password", "")
        masked["configured"] = bool(masked.get("user") and raw_pass)
        masked["password"] = _mask_secret(raw_pass)
        return masked

    def get_llm_config(self, masked: bool = True) -> dict[str, Any]:
        with _lock:
            llm = deepcopy(_load_raw()["llm"])
        if masked:
            return self._apply_llm_mask(llm)
        return llm

    def get_email_config(self, masked: bool = True) -> dict[str, Any]:
        with _lock:
            email_cfg = deepcopy(_load_raw()["email"])
        if masked:
            return self._apply_email_mask(email_cfg)
        return email_cfg

    def get_provider_presets(self) -> dict[str, Any]:
        return {
            "types": PROVIDER_TYPES,
            "presets": PROVIDER_PRESETS,
        }

    def update_llm_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        with _lock:
            raw = _load_raw()
            current = raw["llm"]
            new_llm = deepcopy(current)

            if "default_provider" in payload:
                new_llm["default_provider"] = payload["default_provider"]
            if "temperature" in payload:
                new_llm["temperature"] = float(payload["temperature"])
            if "max_tokens" in payload:
                new_llm["max_tokens"] = int(payload["max_tokens"])

            if "providers" in payload:
                existing_by_id = {p["id"]: p for p in current.get("providers", [])}
                merged: list[dict[str, Any]] = []
                for item in payload["providers"]:
                    pid = item["id"]
                    prev = existing_by_id.get(pid, {})
                    api_key = item.get("api_key", "")
                    if is_masked(api_key):
                        api_key = prev.get("api_key", "")
                    merged.append({
                        "id": pid,
                        "name": item.get("name") or prev.get("name") or pid,
                        "type": item.get("type") or prev.get("type") or "openai_compatible",
                        "base_url": item.get("base_url") or prev.get("base_url", ""),
                        "model": item.get("model") or prev.get("model", ""),
                        "api_key": api_key,
                        "enabled": item.get("enabled", prev.get("enabled", True)),
                    })
                new_llm["providers"] = merged

            raw["llm"] = new_llm
            _save_raw(raw)
            return self._apply_llm_mask(new_llm)

    def update_email_config(self, payload: dict[str, Any]) -> dict[str, Any]:
        with _lock:
            raw = _load_raw()
            current = raw["email"]
            password = payload.get("password", current.get("password", ""))
            if is_masked(password):
                password = current.get("password", "")

            raw["email"] = {
                "provider": "gmail",
                "user": payload.get("user", current.get("user", "")),
                "password": password,
                "imap_host": payload.get("imap_host", current.get("imap_host", GMAIL_DEFAULTS["imap_host"])),
                "smtp_host": payload.get("smtp_host", current.get("smtp_host", GMAIL_DEFAULTS["smtp_host"])),
                "smtp_port": int(payload.get("smtp_port", current.get("smtp_port", GMAIL_DEFAULTS["smtp_port"]))),
            }
            _save_raw(raw)
            return self._apply_email_mask(raw["email"])

    def get_provider_credentials(self, provider_id: str | None = None) -> list[dict[str, Any]]:
        """Return enabled providers with unmasked secrets for internal use."""
        llm = self.get_llm_config(masked=False)
        providers = [p for p in llm.get("providers", []) if p.get("enabled", True)]
        if provider_id:
            providers = [p for p in providers if p["id"] == provider_id]
        resolved: list[dict[str, Any]] = []
        for p in providers:
            item = deepcopy(p)
            item["api_key"] = effective_api_key(p)
            resolved.append(item)
        return resolved

    def get_email_credentials(self) -> dict[str, Any]:
        return self.get_email_config(masked=False)

    def get_generation_params(self) -> tuple[float, int]:
        """Return (temperature, max_tokens) from runtime LLM config."""
        llm = self.get_llm_config(masked=False)
        return (
            float(llm.get("temperature", settings.llm_temperature)),
            int(llm.get("max_tokens", settings.llm_max_tokens)),
        )

    def get_prompt(self, key: str) -> str | None:
        """Get a user-customized prompt from app_settings."""
        try:
            with db.get_db() as conn:
                row = conn.execute(
                    "SELECT data_json FROM app_settings WHERE category = ?",
                    (f"prompt_{key}",),
                ).fetchone()
                if row:
                    data = json.loads(row["data_json"])
                    return data.get("content")
        except Exception:
            logger.warning("Failed to load prompt '%s' from DB", key, exc_info=True)
        return None

    def save_prompt(self, key: str, content: str) -> None:
        """Save a user-customized prompt to app_settings."""
        now = datetime.now(UTC).isoformat()
        category = f"prompt_{key}"
        try:
            with db.get_db() as conn:
                conn.execute(
                    """INSERT INTO app_settings (category, data_json, updated_at)
                       VALUES (?, ?, ?)
                       ON CONFLICT(category) DO UPDATE SET
                         data_json = excluded.data_json,
                         updated_at = excluded.updated_at""",
                    (category, json.dumps({"content": content, "key": key}, ensure_ascii=False), now),
                )
            # Emit audit event so config changes are visible in the
            # event stream. The payload is metadata only — prompt content
            # stays in app_settings (it may contain sensitive content).
            from app.core.runtime.kernel_instance import kernel
            kernel.emit_event(
                "AppConfigChanged",
                "app_config",
                category,
                payload={"category": category, "updated_at": now},
                actor="user",
            )
            # Invalidate cache to reload prompts
            invalidate_runtime_config_cache()
        except Exception:
            logger.warning("Failed to save prompt '%s' to DB", key, exc_info=True)
            raise

    def configure_notification_channels(
        self,
        *,
        webhook_url: str | None = None,
        ntfy_topic: str | None = None,
        ntfy_server: str | None = None,
    ) -> None:
        """Apply notification delivery settings (Product/API-facing ABI)."""
        from app.core.runtime.notification_channel import notification_router

        notification_router.configure(
            webhook_url=webhook_url or "",
            ntfy_topic=ntfy_topic or "",
            ntfy_server=ntfy_server or "https://ntfy.sh",
        )


if TYPE_CHECKING:
    runtime_config: RuntimeConfig
else:
    runtime_config = _LazyProxy(lambda: runtime.runtime_config)
