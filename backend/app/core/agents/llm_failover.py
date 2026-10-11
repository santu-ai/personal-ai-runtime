"""Multi-LLM Router — supports multiple LLM providers with fallback.

Allows configuring multiple LLM providers and automatically switches
when the primary provider fails. Configuration comes from runtime_config
with .env as initial seed.
"""

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any

from openai import AsyncOpenAI

from app.core.runtime.runtime_config import effective_api_key, runtime_config
from app.core.runtime.runtime_container import _LazyProxy, runtime

logger = logging.getLogger(__name__)

# 每 token 价格默认值（USD）——按 DeepSeek 定价估算，供遥测成本计算。
# 接入其他厂商时应显式传入，而非依赖默认。
_DEFAULT_PROMPT_TOKEN_PRICE = 0.000001
_DEFAULT_COMPLETION_TOKEN_PRICE = 0.000002

# Ollama 默认端口——与 config.py 的 ollama_base_url 默认值保持一致。
# 探测 base_url 未显式携带端口时回退到该值。
_OLLAMA_DEFAULT_PORT = 11434

# Today's sealed and dev evals used this model. It is a recommendation to
# pull, not a name we call unless `ollama` `/api/tags` lists it.
RECOMMENDED_LOCAL_MODEL = "qwen2.5:3b"
LOCAL_MODEL_MISSING_MESSAGE = (
    "这台电脑上还没有可用的本地模型。"
    "推荐拉取 qwen2.5:3b，今天的评测用的是它。"
    "在首次引导里拉取，或到设置里改成已经安装的模型，然后重新执行。"
)
_STOCK_LOCAL_MODELS = frozenset({"qwen2.5:7b", "qwen2.5:3b"})
_TAGS_TTL_SECONDS = 15.0
_tags_lock = threading.Lock()
_tags_cache: dict[str, tuple[float, list[str] | None]] = {}

_PULL_STATUS = {
    "pulling manifest": "正在读取模型清单",
    "verifying sha256 digest": "正在校验下载",
    "writing manifest": "正在写入模型",
    "removing any unused layers": "正在清理旧层",
    "success": "已安装",
}


def clear_installed_model_cache() -> None:
    with _tags_lock:
        _tags_cache.clear()


def ollama_native_origin(base_url: str) -> str:
    """OpenAI-compatible `/v1` URLs still list models on the daemon origin."""
    raw = (base_url or "").strip()
    if not raw:
        return ""
    parsed = urllib.parse.urlparse(raw if "://" in raw else f"http://{raw}")
    host = parsed.hostname or "localhost"
    port = parsed.port or _OLLAMA_DEFAULT_PORT
    scheme = parsed.scheme or "http"
    return f"{scheme}://{host}:{port}"


def is_ollama_endpoint(provider_type: str, base_url: str) -> bool:
    if provider_type == "ollama":
        return True
    try:
        parsed = urllib.parse.urlparse(base_url or "")
    except ValueError:
        return False
    return parsed.port == _OLLAMA_DEFAULT_PORT


def model_name_is_explicit(model: str) -> bool:
    """Env-selected names and anything other than the stock defaults."""
    name = (model or "").strip()
    if not name:
        return False
    if os.getenv("OLLAMA_MODEL", "").strip() == name:
        return True
    if os.getenv("LLM_MODEL", "").strip() == name:
        return True
    return name not in _STOCK_LOCAL_MODELS


def choose_local_model(
    installed: list[str],
    requested: str = "",
    *,
    explicit: bool = False,
) -> str | None:
    """Pick a name that is actually installed.

    An explicit request wins when it is in the list. Otherwise prefer
    ``qwen2.5:3b``, then the requested name, then the first installed name.
    Never returns a name that `/api/tags` did not list.
    """
    names: list[str] = []
    seen: set[str] = set()
    for raw in installed:
        name = str(raw or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    if not names:
        return None
    wanted = (requested or "").strip()
    if explicit and wanted in names:
        return wanted
    if RECOMMENDED_LOCAL_MODEL in names:
        return RECOMMENDED_LOCAL_MODEL
    if wanted in names:
        return wanted
    return names[0]


def fetch_installed_model_names(base_url: str, *, timeout: float = 1.5) -> list[str] | None:
    """Names from Ollama `/api/tags`. None when the daemon does not answer."""
    origin = ollama_native_origin(base_url)
    if not origin:
        return None
    now = time.monotonic()
    with _tags_lock:
        cached = _tags_cache.get(origin)
        if cached is not None and now - cached[0] < _TAGS_TTL_SECONDS:
            return list(cached[1]) if cached[1] is not None else None
    installed = _read_ollama_tags(origin, timeout)
    with _tags_lock:
        _tags_cache[origin] = (time.monotonic(), None if installed is None else list(installed))
    return None if installed is None else list(installed)


def _read_ollama_tags(origin: str, timeout: float) -> list[str] | None:
    url = f"{origin}/api/tags"
    try:
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError, UnicodeError, TimeoutError, ValueError):
        return None
    rows = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    names: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("model") or "").strip()
        if name:
            names.append(name)
    return names


def _progress_amount(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def pull_status_line(row: dict[str, Any], name: str) -> str:
    """Chinese progress for one Ollama pull event."""
    total = _progress_amount(row.get("total"))
    completed = _progress_amount(row.get("completed"))
    if total and completed is not None and total > 0:
        percent = min(100, int(completed * 100 / total))
        return f"正在下载 {name}（{percent}%）"
    status = str(row.get("status") or "")
    mapped = _PULL_STATUS.get(status)
    if mapped == "已安装":
        return f"已安装 {name}"
    if mapped:
        return mapped
    if status:
        return status
    return f"正在拉取 {name}"


def _ndjson(row: dict[str, Any]) -> bytes:
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


def iter_recommended_pull(base_url: str, name: str) -> Iterator[bytes]:
    """Stream pull progress. Only the recommended model is accepted."""
    if name != RECOMMENDED_LOCAL_MODEL:
        raise ValueError(name)
    origin = ollama_native_origin(base_url)
    if not origin:
        yield _ndjson({"status": "没有本地模型地址。", "ok": False})
        return
    payload = json.dumps({"model": name, "name": name, "stream": True}).encode("utf-8")
    request = urllib.request.Request(
        f"{origin}/api/pull",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        response = urllib.request.urlopen(request, timeout=3600)
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        yield _ndjson({"status": "连不上 Ollama。先启动它，再拉取。", "ok": False})
        return
    installed = False
    try:
        with response:
            for raw in response:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(row, dict):
                    continue
                error = row.get("error")
                if error:
                    yield _ndjson({"status": f"拉取失败：{error}", "ok": False})
                    return
                if row.get("status") == "success":
                    installed = True
                yield _ndjson({"status": pull_status_line(row, name), "ok": installed})
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        yield _ndjson({"status": "拉取中断。确认 Ollama 仍在运行后重试。", "ok": False})
        return
    if not installed:
        return
    clear_installed_model_cache()
    try:
        from app.core.runtime.runtime_config import runtime_config as config

        config.adopt_local_model(name)
    except Exception:
        logger.warning("pulled model %s could not be saved", name, exc_info=True)
        yield _ndjson({
            "status": f"已安装 {name}，但没有写入设置。到设置里把模型改成 {name}。",
            "ok": False,
        })


def describe_local_models(base_url: str, installed: list[str] | None) -> dict[str, Any]:
    """Status the first-run screen can show without calling a missing model."""
    if installed is None:
        return {
            "reachable": False,
            "installed": [],
            "recommended": RECOMMENDED_LOCAL_MODEL,
            "recommended_installed": False,
            "selected": None,
            "message": "这台电脑上还没连上 Ollama。先启动它，或到设置里填写一个能用的模型地址。",
        }
    selected = choose_local_model(installed)
    if not installed:
        message = (
            f"Ollama 已启动，但还没有模型。可以拉取 {RECOMMENDED_LOCAL_MODEL}。"
            "今天的评测用的是这个模型。"
        )
    elif selected == RECOMMENDED_LOCAL_MODEL:
        message = f"已安装 {RECOMMENDED_LOCAL_MODEL}。今天的评测用的是它，建议就用这个。"
    else:
        message = (
            f"还没有 {RECOMMENDED_LOCAL_MODEL}。已安装的模型里先用 {selected}。"
            "也可以拉取推荐的模型。"
        )
    return {
        "reachable": True,
        "installed": list(installed),
        "recommended": RECOMMENDED_LOCAL_MODEL,
        "recommended_installed": RECOMMENDED_LOCAL_MODEL in installed,
        "selected": selected,
        "message": message,
        "base_url": base_url,
    }


@dataclass
class LLMProvider:
    """Configuration for a single LLM provider."""

    name: str
    api_key: str
    base_url: str
    model: str
    provider_type: str = "openai_compatible"
    is_default: bool = False
    # 每 token 价格（USD），仅用于遥测成本估算（brain_telemetry）。
    # 当前 runtime_config 不提供价格字段，这是唯一生效的价格来源；
    # 默认值按 DeepSeek 定价估算，若接入其他厂商应显式传值。
    price_per_prompt_token: float = _DEFAULT_PROMPT_TOKEN_PRICE
    price_per_completion_token: float = _DEFAULT_COMPLETION_TOKEN_PRICE


class LLMRouter:
    """Routes LLM requests to the appropriate provider with fallback."""

    def __init__(self):
        self.providers: list[LLMProvider] = []
        self._clients: dict[str, AsyncOpenAI] = {}
        self._load_providers()

    def _resolve_api_key(self, provider: dict) -> str:
        return effective_api_key(provider)

    def _load_providers(self):
        """Load providers from runtime_config."""
        llm = runtime_config.get_llm_config(masked=False)
        default_id = llm.get("default_provider", "deepseek")
        self.providers = []
        self._clients = {}

        for item in llm.get("providers", []):
            if not item.get("enabled", True):
                continue
            api_key = self._resolve_api_key(item)
            self.providers.append(
                LLMProvider(
                    name=item["id"],
                    api_key=api_key,
                    base_url=item.get("base_url", ""),
                    model=item.get("model", ""),
                    provider_type=item.get("type", "openai_compatible"),
                    is_default=item["id"] == default_id,
                )
            )

        if self.providers and not any(p.is_default for p in self.providers):
            self.providers[0].is_default = True

    def reload(self):
        """Reload providers after runtime config changes."""
        self._load_providers()

    @staticmethod
    def _build_client(provider: LLMProvider) -> AsyncOpenAI:
        """按 provider 配置构造 OpenAI 兼容 client。

        延迟构造（首次访问时）而非在 _load_providers 里预热，
        避免启动阶段因 LLM 配置尚未就绪而失败；client 缓存于 _clients。
        """
        from app.config import settings

        return AsyncOpenAI(
            api_key=provider.api_key,
            base_url=provider.base_url,
            timeout=float(settings.llm_timeout_seconds),
            max_retries=3,
        )

    def _client_for(self, provider: LLMProvider) -> AsyncOpenAI:
        if provider.name not in self._clients:
            self._clients[provider.name] = self._build_client(provider)
        return self._clients[provider.name]

    def get_client(self, provider_name: str | None = None) -> tuple[AsyncOpenAI, LLMProvider]:
        """Get a client for the specified provider, or the default one."""
        if provider_name:
            for p in self.providers:
                if p.name == provider_name:
                    return self._client_for(p), p
            raise RuntimeError(f"LLM provider not configured: {provider_name}")

        for p in self.providers:
            if p.is_default:
                return self._client_for(p), p

        raise RuntimeError("No LLM provider configured")

    def prepare_call(self, provider: LLMProvider) -> LLMProvider | None:
        """Model to call. Local names come from `/api/tags`, not a stock default."""
        if not is_ollama_endpoint(provider.provider_type, provider.base_url):
            return provider if (provider.model or "").strip() else None
        installed = fetch_installed_model_names(provider.base_url)
        explicit = model_name_is_explicit(provider.model)
        if installed is None:
            chosen = provider.model.strip() if explicit and provider.model.strip() else None
        else:
            chosen = choose_local_model(installed, provider.model, explicit=explicit)
        if not chosen:
            return None
        if chosen != provider.model:
            logger.info("ollama model %s is not installed; using %s", provider.model, chosen)
            return replace(provider, model=chosen)
        return provider

    def fallbacks_after(
        self,
        primary: LLMProvider | None,
    ) -> list[tuple[AsyncOpenAI, LLMProvider]]:
        """Other providers that can be called, skipping a duplicate local model."""
        seen: set[tuple[str, str]] = set()
        if primary is not None and is_ollama_endpoint(primary.provider_type, primary.base_url):
            seen.add((ollama_native_origin(primary.base_url), primary.model))
        kept: list[tuple[AsyncOpenAI, LLMProvider]] = []
        for provider in self.providers:
            if provider.is_default:
                continue
            ready = self.prepare_call(provider)
            if ready is None:
                continue
            if is_ollama_endpoint(ready.provider_type, ready.base_url):
                key = (ollama_native_origin(ready.base_url), ready.model)
                if key in seen:
                    continue
                seen.add(key)
            kept.append((self._client_for(provider), ready))
        return kept

    def callable_candidates(
        self,
        provider_name: str | None = None,
    ) -> list[tuple[AsyncOpenAI, LLMProvider]]:
        """Primary, then other providers, with missing local models removed."""
        client, provider = self.get_client(provider_name)
        ready = self.prepare_call(provider)
        candidates: list[tuple[AsyncOpenAI, LLMProvider]] = []
        if ready is not None:
            candidates.append((client, ready))
        if provider_name is None:
            candidates.extend(self.fallbacks_after(ready))
        return candidates

    def get_fallback_clients(self) -> list[tuple[AsyncOpenAI, LLMProvider]]:
        """Non-default providers whose model can actually be called."""
        return self.fallbacks_after(None)

    def _provider_available(self, provider: LLMProvider) -> bool:
        if provider.provider_type == "ollama":
            if not provider.base_url:
                return False
            try:
                import socket
                import urllib.parse

                parsed = urllib.parse.urlparse(provider.base_url)
                host = parsed.hostname or "localhost"
                port = parsed.port or _OLLAMA_DEFAULT_PORT
                sock = socket.create_connection((host, port), timeout=0.5)
                sock.close()
                return True
            except (OSError, ValueError):
                # OSError 覆盖 gaierror(DNS) / timeout / herror 等 socket 失败；
                # ValueError 覆盖 urlparse 对非法端口（如 "host:abc"）的拒绝。
                # 探测失败一律视为不可用，不让单条配置拖垮整个 provider 列表。
                return False
        return bool(provider.api_key)

    def list_providers(self) -> list[dict]:
        """List all configured providers with availability."""
        return [
            {
                "name": p.name,
                "model": p.model,
                "type": p.provider_type,
                "is_default": p.is_default,
                "available": self._provider_available(p),
            }
            for p in self.providers
        ]

    def get_default_model(self) -> str:
        """Get the default model name."""
        for p in self.providers:
            if p.is_default:
                return p.model
        return "deepseek-chat"


# Singleton — lazy proxy to RuntimeContainer so runtime.reset() rebuilds it.
if TYPE_CHECKING:
    llm_router: LLMRouter
else:
    llm_router = _LazyProxy(lambda: runtime.llm_router)
