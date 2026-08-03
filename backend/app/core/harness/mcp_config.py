"""加载并校验 mcp_config.json 中的 MCP mesh 配置。

外部 MCP server 的声明（启动命令、env、策略默认值）全部源自该文件；
本地个人服务器声明放在被 gitignore 的 local 覆盖文件中。
"""

from __future__ import annotations

import fnmatch
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_VALID_POLICY_DEFAULTS = frozenset({"auto_allow", "needs_user", "forbidden"})

# 缓存键 = (主文件路径, local 覆盖路径, 两者 mtime)；值 = 解析后的数据。
_mcp_config_cache: tuple[tuple[str, str, float, float], dict[str, Any]] | None = None


def normalize_tool_name(name: str) -> str:
    """把 MCP 工具名规整为 LLM 注册用的形态（字母数字 + 下划线）。"""
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)


def external_tool_id(server_name: str, tool_name: str) -> str:
    """构造稳定、抗碰撞的能力名（用于 capability 治理登记）。"""
    return f"{server_name}_{normalize_tool_name(tool_name)}"


def mcp_external_enabled() -> bool:
    """判断外部 MCP mesh 是否启用的唯一事实源。"""
    from app.config import settings

    return settings.mcp_external_enabled


def parse_builtin_tools_enabled() -> set[str] | None:
    """可选的 env 覆盖：逗号分隔的 server 名单。None = 采用 json 配置。"""
    from app.config import settings

    raw = settings.builtin_tools_enabled.strip()
    if not raw or raw == "*":
        return None
    return {part.strip() for part in raw.split(",") if part.strip()}


def _matches_tool_pattern(tool_name: str, pattern: str) -> bool:
    """按 fnmatch 通配（``create_*``）或精确相等匹配工具名。"""
    if any(ch in pattern for ch in "*?["):
        return fnmatch.fnmatchcase(tool_name, pattern)
    return tool_name == pattern


def _settings_env_map() -> dict[str, str]:
    """把 mcp_config.json 声明的 env key 映射到 settings 中的凭据值。

    凭据统一从 settings 读取，保证「配置声明了某 env key」与「实际拥有
    该凭据」用同一张表判断，避免新增凭据时两处失同步。
    """
    from app.config import settings

    return {
        "BRAVE_API_KEY": settings.brave_api_key,
        "CONTEXT7_API_KEY": settings.context7_api_key,
        "GITHUB_PERSONAL_ACCESS_TOKEN": settings.github_personal_access_token,
        "TAVILY_API_KEY": settings.tavily_api_key,
        "NOTION_TOKEN": settings.notion_token,
        "TAPD_ACCESS_TOKEN": settings.tapd_access_token,
        "TAPD_DEFAULT_WORKSPACE_ID": settings.tapd_default_workspace_id,
        "TAPD_NICK_NAME": settings.tapd_nick_name,
        "TUSHARE_TOKEN": settings.tushare_token,
    }


@dataclass
class ExternalMCPServerConfig:
    """单个外部 MCP server 的运行时配置视图（从 json 条目构建）。"""

    name: str
    command: str
    args: list[str]
    env: dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    tool_prefix: str = ""
    policy_default: str = "auto_allow"  # auto_allow | needs_user | forbidden
    needs_user_tools: list[str] = field(default_factory=list)
    needs_user_patterns: list[str] = field(default_factory=list)
    ingestion_tools: list[str] = field(default_factory=list)
    ingestion_patterns: list[str] = field(default_factory=list)
    required_env: list[str] = field(default_factory=list)
    optional_env: list[str] = field(default_factory=list)
    enabled_tools: list[str] = field(default_factory=list)
    startup_connect: bool = True
    connect_timeout_seconds: float = 45.0
    call_timeout_seconds: float = 30.0

    @property
    def registration_prefix(self) -> str:
        return self.tool_prefix or self.name

    def is_available(self) -> bool:
        """所需 env 就绪（或无需 env）时该 server 才能启动。"""
        if not self.enabled:
            return False
        if self.required_env:
            return self.has_required_credentials()
        return True

    def resolve_env(self) -> dict[str, str]:
        from app.core.harness.subprocess_env import minimal_subprocess_env

        settings_env = _settings_env_map()
        extra = dict(self.env)
        for key in self.required_env + self.optional_env:
            val = settings_env.get(key, "").strip()
            if val:
                extra[key] = val
        return minimal_subprocess_env(extra=extra)

    def has_required_credentials(self) -> bool:
        settings_env = _settings_env_map()
        for key in self.required_env:
            if self.env.get(key, "").strip():
                continue
            if settings_env.get(key, "").strip():
                continue
            return False
        return True

    def should_expose_tool(self, tool_name: str) -> bool:
        if not self.enabled_tools:
            return True
        return tool_name in self.enabled_tools

    def tool_needs_user(self, tool_name: str) -> bool:
        if tool_name in self.needs_user_tools:
            return True
        for pattern in self.needs_user_patterns:
            if _matches_tool_pattern(tool_name, pattern):
                return True
        return self.policy_default == "needs_user"

    def tool_is_ingestion(self, tool_name: str) -> bool:
        if tool_name in self.ingestion_tools:
            return True
        for pattern in self.ingestion_patterns:
            if _matches_tool_pattern(tool_name, pattern):
                return True
        return False


def clear_mcp_config_cache() -> None:
    """测试辅助——丢弃基于 mtime 的配置缓存。"""
    global _mcp_config_cache
    _mcp_config_cache = None


def _load_config_file(path: Path) -> dict[str, Any]:
    """加载单个配置文件；缺失或非法时返回 ``{}``。"""
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to load MCP config %s: %s", path, exc)
        return {}


def _merge_external_servers(
    main: list[dict[str, Any]],
    local: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """合并两份 ``external_servers``；local 按 ``name`` 覆盖 main。

    顺序保持：main 的 server 在前（除非被 local 同名覆盖），local 独有
    的排在后。这样内置顺序稳定，同时允许个人 MCP（TAPD、Jira、内部工具）
    存放在被 gitignore 的文件中。
    """
    local_by_name = {entry.get("name"): entry for entry in local if entry.get("name")}
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in main:
        name = entry.get("name")
        if not name:
            merged.append(entry)
            continue
        seen.add(name)
        merged.append(local_by_name.pop(name, entry))
    # 仅存在于 local 的 server（未覆盖任何 main 条目）。
    for name, entry in local_by_name.items():
        if name not in seen:
            merged.append(entry)
    return merged


def load_mcp_config(path: str | Path | None = None) -> dict[str, Any]:
    from app.config import settings

    global _mcp_config_cache

    config_path = Path(path or settings.mcp_config_path)
    # local 覆盖仅在读取配置的主路径时生效——测试传显式 ``path``
    # 时得到纯单文件语义。
    use_local = path is None
    local_path_str = (settings.mcp_local_config_path or "") if use_local else ""
    local_path = Path(local_path_str) if local_path_str else Path()

    main_data = _load_config_file(config_path)
    local_data = _load_config_file(local_path) if local_path_str else {}

    # 缓存键包含两个路径与 mtime，任一侧文件被改都会失效。
    main_mtime = config_path.stat().st_mtime if config_path.is_file() else 0.0
    local_mtime = local_path.stat().st_mtime if local_path.is_file() else 0.0
    cache_key = (str(config_path.resolve()), str(local_path), main_mtime, local_mtime)
    cached = _mcp_config_cache
    if cached is not None and cached[0] == cache_key:
        return cached[1]

    data = dict(main_data)
    if local_data:
        data["external_servers"] = _merge_external_servers(
            main_data.get("external_servers", []),
            local_data.get("external_servers", []),
        )
        # 允许 local 同时扩展内置 ``servers`` 列表。
        local_servers = local_data.get("servers", [])
        if local_servers:
            data.setdefault("servers", [])
            existing = {s.get("name") for s in data["servers"] if isinstance(s, dict)}
            for entry in local_servers:
                if entry.get("name") not in existing:
                    data["servers"].append(entry)

    _mcp_config_cache = (cache_key, data)
    return data


def load_external_server_configs(path: str | Path | None = None) -> list[ExternalMCPServerConfig]:
    from app.config import settings

    if not mcp_external_enabled():
        return []

    allowed = parse_builtin_tools_enabled()
    data = load_mcp_config(path)
    configs: list[ExternalMCPServerConfig] = []
    for raw in data.get("external_servers", []):
        if raw.get("type", "stdio") != "stdio":
            continue
        name = raw.get("name", "")
        command = raw.get("command", "")
        if not name or not command:
            continue
        if allowed is not None and name not in allowed:
            continue
        policy_default = str(raw.get("policy_default", "auto_allow"))
        if policy_default not in _VALID_POLICY_DEFAULTS:
            # Fail closed：策略值拼写错误时不能静默放开整个 server。
            logger.warning(
                "MCP server %r has invalid policy_default %r; skipping server",
                name,
                policy_default,
            )
            continue
        call_timeout = float(raw.get("call_timeout_seconds", settings.tool_timeout_seconds))
        configs.append(
            ExternalMCPServerConfig(
                name=name,
                command=command,
                args=list(raw.get("args", [])),
                env=dict(raw.get("env", {})),
                enabled=bool(raw.get("enabled", True)),
                tool_prefix=str(raw.get("tool_prefix", "")),
                policy_default=policy_default,
                needs_user_tools=list(raw.get("needs_user_tools", [])),
                needs_user_patterns=list(raw.get("needs_user_patterns", [])),
                ingestion_tools=list(raw.get("ingestion_tools", [])),
                ingestion_patterns=list(raw.get("ingestion_patterns", [])),
                required_env=list(raw.get("required_env", [])),
                optional_env=list(raw.get("optional_env", [])),
                enabled_tools=list(raw.get("enabled_tools", [])),
                startup_connect=bool(raw.get("startup_connect", True)),
                connect_timeout_seconds=float(raw.get("connect_timeout_seconds", 45)),
                call_timeout_seconds=call_timeout,
            )
        )
    return configs
