"""Multi-LLM Router — supports multiple LLM providers with fallback.

Allows configuring multiple LLM providers and automatically switches
when the primary provider fails. Configuration comes from runtime_config
with .env as initial seed.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from openai import AsyncOpenAI

from app.core.runtime.runtime_config import effective_api_key, runtime_config
from app.core.runtime.runtime_container import _LazyProxy, runtime

# 每 token 价格默认值（USD）——按 DeepSeek 定价估算，供遥测成本计算。
# 接入其他厂商时应显式传入，而非依赖默认。
_DEFAULT_PROMPT_TOKEN_PRICE = 0.000001
_DEFAULT_COMPLETION_TOKEN_PRICE = 0.000002

# Ollama 默认端口——与 config.py 的 ollama_base_url 默认值保持一致。
# 探测 base_url 未显式携带端口时回退到该值。
_OLLAMA_DEFAULT_PORT = 11434


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

    def get_fallback_clients(self) -> list[tuple[AsyncOpenAI, LLMProvider]]:
        """Get all non-default clients for fallback."""
        return [
            (self._client_for(p), p)
            for p in self.providers
            if not p.is_default
        ]

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
