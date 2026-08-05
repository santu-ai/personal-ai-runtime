"""MCP Mesh——外部 stdio MCP 服务器的连接生命周期与工具发现。

连接与工具注册的语义：

- 每个外部 server 由 ``_ServerConnection`` 独占一个 asyncio 任务持有
  stdio transport + ClientSession（anyio task group 的进入/退出必须在
  同一任务，uvicorn reload 时 shutdown 与 startup 任务不同，故必须钉住）。
- 工具按 ``mcp_config.json`` 的策略（needs_user / forbidden / ingestion）
  分级注册进 MCPHub；调用时先做 SSRF 式 URL 校验，传输层故障才重连重试，
  应用层错误不重试，避免非幂等工具被二次执行。
- ``start`` 连接 startup 级 server，惰性 server 在后台串行连接。
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.shared.exceptions import MCPError  # type: ignore[attr-defined]
from mcp.types import Tool as MCPTool

from app.core.harness.mcp_config import (
    ExternalMCPServerConfig,
    external_tool_id,
    load_external_server_configs,
)
from app.core.harness.url_safety import UnsafeUrlError, validate_http_url_async

logger = logging.getLogger(__name__)

# 扫描工具参数时视为 URL 的字段名（大小写不敏感）。
_URL_ARG_KEYS = frozenset({
    "url", "uri", "href", "link", "endpoint", "target_url", "page_url",
    "base_url", "website",
})

# 暗示传输层已死（而非应用层报错）的错误子串。
_TRANSPORT_ERROR_MARKERS = (
    "closed",
    "not connected",
    "connection reset",
    "broken pipe",
    "eof",
    "transport",
    "session terminated",
    "broken resource",
)


def _is_transport_failure(exc: BaseException) -> bool:
    """判断重连后重试是否安全/有效。

    刻意收窄：不把普通 ``OSError`` / 应用错误当作传输故障，避免
    非幂等工具在服务端已生效副作用后被二次执行。
    """
    if isinstance(exc, (ConnectionError, BrokenPipeError, EOFError)):
        return True
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return any(m in name or m in msg for m in _TRANSPORT_ERROR_MARKERS)


def _safe_mcp_error(server_name: str, exc: BaseException) -> str:
    """返回脱敏、仅含错误分类的字符串，供 LLM 上下文使用。

    原始异常消息可能泄露绝对路径、连接串或内部堆栈到 LLM 工具结果；
    只把错误分类与 server 名返回，细节留在本地日志。
    """
    if isinstance(exc, (ConnectionError, BrokenPipeError, EOFError, asyncio.TimeoutError)):
        category = "connection"
    else:
        category = "unexpected"
    logger.warning(
        "MCP tool failed (server=%s category=%s): %s",
        server_name, category, exc,
        exc_info=True,
    )
    return f"MCP tool failed (server={server_name}, category={category})"


@dataclass
class DiscoveredMCPTool:
    registered_name: str
    server_name: str
    original_name: str
    description: str
    parameters: dict[str, Any]
    requires_confirmation: bool
    is_ingestion: bool
    policy_risk: str  # low | high | forbidden


class _ServerConnection:
    """在专属 asyncio 任务内持有某个 stdio MCP 连接。

    ``stdio_client`` 与 ``ClientSession`` 都会创建 anyio task group，
    其 cancel scope 必须在同一任务内进入*并*退出。uvicorn reload 时
    lifespan 的 shutdown 钩子（从而 ``close``）与启动时的 ``connect``
    不在同一任务，因此把传输层 + 会话的整个生命周期钉在一个 owner
    任务上，用 :class:`~asyncio.Event`（停止信号）与
    :class:`~asyncio.Future`（初始化结果）驱动。
    """

    def __init__(self, config: ExternalMCPServerConfig):
        self.config = config
        self.session: ClientSession | None = None
        self.tools: list[MCPTool] = []
        self._connect_lock = asyncio.Lock()
        self._owner_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._ready: asyncio.Future | None = None

    async def connect(self) -> None:
        async with self._connect_lock:
            if self.session is not None:
                return
            self._stop_event = asyncio.Event()
            self._ready = asyncio.get_running_loop().create_future()
            self._owner_task = asyncio.create_task(
                self._run(), name=f"mcp-conn-{self.config.name}"
            )
            try:
                await self._ready
            except BaseException:
                # 初始化失败或调用方取消——回收 owner 任务。
                await self._teardown(cancel=True)
                raise

    async def _run(self) -> None:
        """owner 任务——进入并持有 transport + session 上下文。"""
        stop_event = self._stop_event
        ready = self._ready
        params = StdioServerParameters(
            command=self.config.command,
            args=self.config.args,
            env=self.config.resolve_env(),
        )
        try:
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    try:
                        await asyncio.wait_for(
                            session.initialize(),
                            timeout=self.config.connect_timeout_seconds,
                        )
                        listed = await asyncio.wait_for(
                            session.list_tools(),
                            timeout=self.config.connect_timeout_seconds,
                        )
                    except Exception as exc:
                        if ready is not None and not ready.done():
                            ready.set_exception(exc)
                        return
                    self.session = session
                    self.tools = list(listed.tools)
                    if ready is not None and not ready.done():
                        ready.set_result(None)
                    # 停在 stop_event 上，直到 close() 发出停止信号——保持
                    # transport + session 上下文在本任务内开启，保证
                    # __aexit__ 总是由 __aenter__ 所在任务执行。
                    if stop_event is not None:
                        await stop_event.wait()
        except Exception as exc:
            # 内层 try 之前 transport/session __aenter__ 就失败了。
            if ready is not None and not ready.done():
                ready.set_exception(exc)
            raise
        finally:
            # 兜底：任务未成功初始化就退出时，绝不让 connect() 挂死。
            if ready is not None and not ready.done():
                ready.set_exception(
                    RuntimeError("MCP owner task exited before setup completed")
                )

    async def close(self) -> None:
        """尽力清理——吞掉一切错误，保证关闭流程永不中断。"""
        await self._teardown(cancel=False)
        self.session = None
        self._stop_event = None
        self._ready = None
        self.tools = []

    async def _teardown(self, *, cancel: bool) -> None:
        """通知 owner 任务停止，按需取消，然后 join 该任务。"""
        if self._stop_event is not None:
            self._stop_event.set()
        task = self._owner_task
        if task is not None and not task.done():
            if cancel:
                task.cancel()
            try:
                await task
            except BaseException:
                logger.debug(
                    "MCP owner task for %s raised during teardown",
                    self.config.name,
                    exc_info=True,
                )
        self._owner_task = None


class MCPMesh:
    """外部 stdio MCP server 的生命周期管理器。"""

    def __init__(self) -> None:
        self._connections: dict[str, _ServerConnection] = {}
        self._pending_configs: dict[str, ExternalMCPServerConfig] = {}
        # 保留配置以便在线连接断开后重建。
        self._configs: dict[str, ExternalMCPServerConfig] = {}
        self._tool_index: dict[str, tuple[str, str]] = {}
        self._discovered: list[DiscoveredMCPTool] = []
        # 已完成工具发现（含仅 forbidden）的 server 集合。
        self._discovered_servers: set[str] = set()
        # 每个 server 最近一次连接/断连错误（供 get_server_status 呈现）。
        self._connect_errors: dict[str, str] = {}
        self._started = False
        self._start_lock = asyncio.Lock()
        self._register_lock = asyncio.Lock()
        # 每 server 连接锁——防止惰性连接与 ensure_server 双重拉起。
        self._server_locks: dict[str, asyncio.Lock] = {}
        self._lazy_task: asyncio.Task | None = None

    def _lock_for(self, server_name: str) -> asyncio.Lock:
        lock = self._server_locks.get(server_name)
        if lock is None:
            lock = asyncio.Lock()
            self._server_locks[server_name] = lock
        return lock

    @property
    def discovered_tools(self) -> list[DiscoveredMCPTool]:
        return list(self._discovered)

    def is_external_tool(self, name: str) -> bool:
        return name in self._tool_index

    async def start(self) -> list[DiscoveredMCPTool]:
        async with self._start_lock:
            if self._started:
                return self.discovered_tools

            configs = load_external_server_configs()
            startup_configs = [c for c in configs if c.is_available() and c.startup_connect]
            lazy_configs = [c for c in configs if c.is_available() and not c.startup_connect]

            for config in configs:
                self._configs[config.name] = config
            for config in lazy_configs:
                self._pending_configs[config.name] = config

            if startup_configs:
                await self._connect_servers_parallel(startup_configs)

            self._started = True

            if lazy_configs:
                self._lazy_task = asyncio.create_task(
                    self._connect_lazy_servers(lazy_configs),
                    name="mcp-mesh-lazy-connect",
                )

            return self.discovered_tools

    async def stop(self) -> None:
        async with self._start_lock:
            if self._lazy_task is not None:
                self._lazy_task.cancel()
                try:
                    await self._lazy_task
                except asyncio.CancelledError:
                    pass
                self._lazy_task = None

            from app.core.harness.mcp_hub import mcp_hub
            from app.core.runtime.capability_governance import capability_governance
            from app.core.runtime.taint import (
                clear_external_ingestion_tools,
                clear_external_write_tools,
            )

            for name in list(self._tool_index):
                mcp_hub.unregister_tool(name)
            capability_governance.clear_external_tools()
            clear_external_ingestion_tools()
            clear_external_write_tools()

            for conn in self._connections.values():
                try:
                    await conn.close()
                except Exception:
                    logger.exception("Error closing MCP server '%s'", conn.config.name)
            self._connections.clear()
            self._pending_configs.clear()
            self._configs.clear()
            self._tool_index.clear()
            self._discovered.clear()
            self._discovered_servers.clear()
            self._connect_errors.clear()
            self._server_locks.clear()
            self._started = False

    async def call_tool(self, registered_name: str, arguments: dict[str, Any]) -> str:
        if registered_name not in self._tool_index:
            return json.dumps({"error": f"Unknown external tool: {registered_name}"})

        from app.core.runtime.capability_governance import capability_governance

        if capability_governance.is_forbidden(registered_name):
            return json.dumps({"error": f"Tool forbidden: {registered_name}"})

        server_name, original_name = self._tool_index[registered_name]
        try:
            conn = await self._ensure_server(server_name)
        except Exception as exc:
            return json.dumps({"error": _safe_mcp_error(server_name, exc)})

        url_err = await self._validate_tool_arguments(original_name, arguments)
        if url_err:
            return json.dumps({"error": url_err})

        try:
            result = await self._call_with_reconnect(
                conn, server_name, original_name, arguments, registered_name
            )
        except asyncio.TimeoutError:
            return json.dumps({"error": f"MCP tool timed out: {registered_name}"})
        except MCPError as exc:
            # v2 下工具失败以 JSON-RPC 错误浮现——把消息透传给 LLM 让其自纠
            # （v1 是以 is_error 内容返回）。
            return json.dumps({"error": f"MCP tool error: {exc.message}"})
        except Exception as exc:
            return json.dumps({"error": _safe_mcp_error(server_name, exc)})

        parts: list[str] = []
        for block in result.content:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
            else:
                parts.append(str(block))
        # 兼容 v1 协议的外部 server——仍以 CallToolResult(is_error=True)
        # 而非抛 MCPError 的方式上报错误。
        if result.is_error:
            return json.dumps({"error": "\n".join(parts) or "MCP tool returned error"})
        return "\n".join(parts) if parts else json.dumps({"status": "ok", "result": None})

    async def _call_with_reconnect(
        self,
        conn: _ServerConnection,
        server_name: str,
        original_name: str,
        arguments: dict[str, Any],
        registered_name: str,
    ) -> Any:
        """调用一次；仅在传输层故障时重连重试。

        应用/协议错误不重试——避免服务端已生效副作用时非幂等工具被二次执行。
        ``MCPError`` 须在传输层分类器之前捕获，因为其 ``message`` 可能含
        "closed"/"eof" 等会误触 ``_is_transport_failure`` 的标记。
        """
        try:
            return await asyncio.wait_for(
                conn.session.call_tool(original_name, arguments),  # type: ignore[union-attr]
                timeout=conn.config.call_timeout_seconds,
            )
        except asyncio.TimeoutError:
            raise
        except MCPError:
            # v2 协议/应用错误——绝不重试（副作用可能已生效）。
            raise
        except Exception as first_exc:
            if not _is_transport_failure(first_exc):
                raise
            logger.warning(
                "MCP tool %s failed on %s (%s); attempting reconnect",
                registered_name,
                server_name,
                type(first_exc).__name__,
            )
            await self._mark_disconnected(server_name)
            conn = await self._ensure_server(server_name)
            return await asyncio.wait_for(
                conn.session.call_tool(original_name, arguments),  # type: ignore[union-attr]
                timeout=conn.config.call_timeout_seconds,
            )

    async def _mark_disconnected(self, server_name: str) -> None:
        async with self._lock_for(server_name):
            conn = self._connections.pop(server_name, None)
            if conn is not None:
                try:
                    await conn.close()
                except Exception:
                    logger.warning(
                        "Error closing dead MCP session for %s",
                        server_name,
                        exc_info=True,
                    )
            config = self._configs.get(server_name)
            if config is not None:
                self._pending_configs[server_name] = config
            self._connect_errors.setdefault(server_name, "transport_disconnected")

    async def _connect_servers_parallel(self, configs: list[ExternalMCPServerConfig]) -> None:
        results = await asyncio.gather(
            *[self._connect_server_safe(config) for config in configs],
            return_exceptions=True,
        )
        for config, result in zip(configs, results):
            if isinstance(result, Exception):
                self._connect_errors[config.name] = (
                    f"{type(result).__name__}: {result}"
                )
                logger.warning(
                    "MCP server '%s' unavailable: %s",
                    config.name,
                    type(result).__name__,
                )
            else:
                self._connect_errors.pop(config.name, None)

    async def _connect_lazy_servers(self, configs: list[ExternalMCPServerConfig]) -> None:
        for config in configs:
            try:
                await self._connect_server_safe(config)
                self._pending_configs.pop(config.name, None)
                self._connect_errors.pop(config.name, None)
            except Exception as e:
                self._connect_errors[config.name] = f"{type(e).__name__}: {e}"
                logger.warning(
                    "MCP server '%s' (lazy connect) unavailable: %s",
                    config.name,
                    type(e).__name__,
                )

    async def _connect_server_safe(self, config: ExternalMCPServerConfig) -> list[DiscoveredMCPTool]:
        discovered = await self._connect_server(config)
        await self._register_discovered_tools(discovered)
        if discovered:
            logger.info(
                "MCP server '%s' connected with %d tools",
                config.name,
                len(discovered),
            )
        else:
            # 返回空说明已连接（惰性/ensure 竞争）或 server 未暴露工具——
            # 不要误导性地记录一次零工具连接。
            logger.debug(
                "MCP server '%s' connect returned 0 new tools",
                config.name,
            )
        return discovered

    async def _register_discovered_tools(self, discovered: list[DiscoveredMCPTool]) -> None:
        if not discovered:
            return
        async with self._register_lock:
            from app.core.harness.mcp_hub import mcp_hub

            mcp_hub.register_mesh_tools(discovered)

    async def _ensure_server(self, server_name: str) -> _ServerConnection:
        conn = self._connections.get(server_name)
        if conn is not None and conn.session is not None:
            return conn

        config = (
            self._pending_configs.get(server_name)
            or self._configs.get(server_name)
            or (conn.config if conn is not None else None)
        )
        if config is None:
            raise RuntimeError(f"server not connected: {server_name}")

        try:
            await self._connect_server_safe(config)
            self._pending_configs.pop(server_name, None)
            self._connect_errors.pop(server_name, None)
        except Exception as exc:
            self._connect_errors[server_name] = f"{type(exc).__name__}: {exc}"
            raise
        conn = self._connections.get(server_name)
        if conn is None or conn.session is None:
            self._connect_errors.setdefault(server_name, "server connect failed")
            raise RuntimeError(f"server connect failed: {server_name}")
        return conn

    async def _validate_tool_arguments(
        self, original_name: str, arguments: dict[str, Any]
    ) -> str | None:
        """拒绝外部 MCP 工具参数中 SSRF 风险的 URL。

        校验嵌套至小深度的 http(s) 字符串，以及常见 URL 命名字段——
        不只针对 Playwright 的 ``browser_navigate``。
        ``original_name`` 保留用于调用点清晰性 / 未来按工具放行白名单。
        DNS 解析经 ``validate_http_url_async`` 在事件循环之外进行。
        """
        _ = original_name
        for url in self._iter_url_candidates(arguments):
            try:
                await validate_http_url_async(url)
            except UnsafeUrlError as exc:
                return f"Blocked URL: {exc}"
        return None

    @classmethod
    def _iter_url_candidates(cls, arguments: dict[str, Any], *, max_depth: int = 3) -> list[str]:
        """从工具参数中收集 http(s) URL 字符串（限深遍历）。"""
        candidates: list[str] = []

        def _maybe_add(key: str, value: str) -> None:
            stripped = value.strip()
            if not stripped:
                return
            if stripped.startswith("http://") or stripped.startswith("https://"):
                candidates.append(stripped)
            elif key.lower() in _URL_ARG_KEYS and "://" in stripped:
                candidates.append(stripped)

        def _walk(obj: Any, key: str, depth: int) -> None:
            if depth > max_depth:
                return
            if isinstance(obj, str):
                _maybe_add(key, obj)
            elif isinstance(obj, dict):
                for child_key, child in obj.items():
                    _walk(child, str(child_key), depth + 1)
            elif isinstance(obj, (list, tuple)):
                for item in obj:
                    _walk(item, key, depth + 1)

        _walk(arguments, "", 0)
        return candidates

    async def _connect_server(self, config: ExternalMCPServerConfig) -> list[DiscoveredMCPTool]:
        async with self._lock_for(config.name):
            self._configs[config.name] = config
            existing = self._connections.get(config.name)
            if existing is not None and existing.session is not None:
                # 已连接（如惰性任务与 ensure_server 竞争）——无需重复连接。
                return []

            if existing is not None:
                # 遗留死会话——替换前先关闭。
                try:
                    await existing.close()
                except Exception:
                    logger.warning(
                        "Error closing stale MCP connection for %s",
                        config.name,
                        exc_info=True,
                    )
                self._connections.pop(config.name, None)

            conn = _ServerConnection(config)
            await conn.connect()
            self._connections[config.name] = conn
            self._connect_errors.pop(config.name, None)

            # 此前已成功发现过（含仅 forbidden、从未进入 ``_tool_index`` 的
            # server）：复用既有索引，避免重复注册。
            if config.name in self._discovered_servers:
                return []

            discovered: list[DiscoveredMCPTool] = []
            for tool in conn.tools:
                if not config.should_expose_tool(tool.name):
                    continue

                registered = external_tool_id(config.registration_prefix, tool.name)
                if registered in self._tool_index:
                    registered = external_tool_id(config.name, tool.name)

                needs_user = config.tool_needs_user(tool.name)
                ingestion = config.tool_is_ingestion(tool.name)
                if config.policy_default == "forbidden":
                    risk = "forbidden"
                elif needs_user:
                    risk = "high"
                else:
                    risk = "low"

                # mcp>=2 uses snake_case; stubs may still advertise inputSchema.
                raw_schema = getattr(tool, "input_schema", None)
                if raw_schema is None:
                    raw_schema = getattr(tool, "inputSchema", None)
                parameters = raw_schema if isinstance(raw_schema, dict) else {
                    "type": "object",
                    "properties": {},
                }

                discovered.append(
                    DiscoveredMCPTool(
                        registered_name=registered,
                        server_name=config.name,
                        original_name=tool.name,
                        description=tool.description or f"MCP tool {tool.name} from {config.name}",
                        parameters=parameters,
                        requires_confirmation=needs_user,
                        is_ingestion=ingestion,
                        policy_risk=risk,
                    )
                )
                # forbidden 工具保留在 discovered（交给治理层 deny），
                # 但不进 mesh 索引，不可经此调用。
                if risk != "forbidden":
                    self._tool_index[registered] = (config.name, tool.name)

            self._discovered_servers.add(config.name)
            self._discovered.extend(discovered)
            return discovered

    def list_server_tools(self, server_name: str) -> list[dict[str, str]]:
        """公开读取某已连接 server 的工具清单（未连接返回空）。"""
        conn = self._connections.get(server_name)
        if conn is None or conn.session is None:
            return []
        return [
            {
                "name": t.name,
                "description": (getattr(t, "description", "") or "")[:100],
            }
            for t in conn.tools
        ]

    def get_server_status(self, server_name: str | None = None) -> dict:
        """返回外部 MCP server 的连接状态。

        指定 ``server_name`` 时返回单 server 字典（``connected`` /
        ``tool_count`` 等状态字段）；否则返回整个 mesh 的状态负载。
        """
        from app.core.harness.mcp_config import load_external_server_configs, mcp_external_enabled

        if not mcp_external_enabled():
            if server_name is not None:
                return {
                    "name": server_name,
                    "status": "disabled",
                    "connected": False,
                    "tool_count": 0,
                }
            return {
                "enabled": False,
                "servers": [],
                "total_tools": 0,
            }

        connected = {
            name
            for name, conn in self._connections.items()
            if conn.session is not None
        }
        servers = []
        for config in load_external_server_configs():
            has_creds = config.is_available()
            if not has_creds:
                servers.append({
                    "name": config.name,
                    "status": "unavailable",
                    "reason": "missing_env",
                    "tool_count": 0,
                    "startup_connect": config.startup_connect,
                    "available": False,
                })
                continue
            if config.name in connected:
                conn = self._connections[config.name]
                servers.append({
                    "name": config.name,
                    "status": "connected",
                    "tool_count": len(conn.tools),
                    "startup_connect": config.startup_connect,
                    "available": True,
                })
            elif config.name in self._pending_configs:
                entry: dict[str, Any] = {
                    "name": config.name,
                    "status": "lazy",
                    "tool_count": 0,
                    "startup_connect": config.startup_connect,
                    "available": True,
                }
                if config.name in self._connect_errors:
                    entry["reason"] = self._connect_errors[config.name]
                servers.append(entry)
            else:
                reason = self._connect_errors.get(config.name) or "not_connected"
                servers.append({
                    "name": config.name,
                    "status": "disconnected",
                    "reason": reason,
                    "tool_count": 0,
                    "startup_connect": config.startup_connect,
                    "available": True,
                })

        if server_name is not None:
            for entry in servers:
                if entry["name"] == server_name:
                    status = entry.get("status", "disconnected")
                    return {
                        **entry,
                        "connected": status == "connected",
                    }
            return {
                "name": server_name,
                "status": "unknown",
                "connected": False,
                "tool_count": 0,
            }

        return {
            "enabled": True,
            "servers": servers,
            "total_tools": len(self._discovered),
        }


mcp_mesh = MCPMesh()
