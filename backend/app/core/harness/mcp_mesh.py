"""MCP Mesh — manages stdio MCP server connections and tool discovery."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.shared.exceptions import MCPError
from mcp.types import Tool as MCPTool

from app.core.harness.mcp_config import (
    ExternalMCPServerConfig,
    external_tool_id,
    load_external_server_configs,
)
from app.core.harness.url_safety import UnsafeUrlError, validate_http_url_async

logger = logging.getLogger(__name__)

# Known URL argument fields (case-insensitive) used when scanning tool args.
_URL_ARG_KEYS = frozenset({
    "url", "uri", "href", "link", "endpoint", "target_url", "page_url",
    "base_url", "website",
})

# Substrings that suggest a dead transport rather than an application error.
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
    """True when retrying after reconnect is likely safe/useful.

    Intentionally narrow: do not treat generic ``OSError`` / app errors as
    transport failures (avoids double-executing non-idempotent tools).
    """
    if isinstance(exc, (ConnectionError, BrokenPipeError, EOFError)):
        return True
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return any(m in name or m in msg for m in _TRANSPORT_ERROR_MARKERS)


def _safe_mcp_error(server_name: str, exc: BaseException) -> str:
    """Return a sanitized, classification-only error string for LLM contexts.

    Raw exception messages can leak absolute paths, connection strings, or
    internal stack details into the LLM tool result. Only the error category
    and the server name are surfaced; the underlying detail is logged locally.
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
    """Owns a stdio MCP connection within a dedicated asyncio task.

    ``stdio_client`` and ``ClientSession`` both create anyio task groups
    whose cancel scopes must be entered *and* exited from the same task.
    On uvicorn reload the lifespan shutdown hook (and therefore
    ``close``) runs in a different task than startup ``connect``, so we
    pin the entire transport + session lifetime to a single owner task
    and drive it with an :class:`~asyncio.Event` (stop signal) and a
    :class:`~asyncio.Future` (setup result).
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
                # Setup failed or caller cancelled — reclaim the owner task.
                await self._teardown(cancel=True)
                raise

    async def _run(self) -> None:
        """Owner task — enters and holds transport + session contexts."""
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
                    # Park here until close() signals stop — holding the
                    # transport + session contexts open in this task so
                    # __aexit__ always runs from the task that __aenter__'d.
                    if stop_event is not None:
                        await stop_event.wait()
        except Exception as exc:
            # Transport/session __aenter__ failed before the inner try.
            if ready is not None and not ready.done():
                ready.set_exception(exc)
            raise
        finally:
            # Guarantee connect() never hangs if we exit without resolving.
            if ready is not None and not ready.done():
                ready.set_exception(
                    RuntimeError("MCP owner task exited before setup completed")
                )

    async def close(self) -> None:
        """Best-effort cleanup — swallow all errors so shutdown never breaks."""
        await self._teardown(cancel=False)
        self.session = None
        self._stop_event = None
        self._ready = None
        self.tools = []

    async def _teardown(self, *, cancel: bool) -> None:
        """Signal the owner task to stop, optionally cancel, then join it."""
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
    """Lifecycle manager for external stdio MCP servers."""

    def __init__(self) -> None:
        self._connections: dict[str, _ServerConnection] = {}
        self._pending_configs: dict[str, ExternalMCPServerConfig] = {}
        # Keep configs for reconnect after a live connection dies.
        self._configs: dict[str, ExternalMCPServerConfig] = {}
        self._tool_index: dict[str, tuple[str, str]] = {}
        self._discovered: list[DiscoveredMCPTool] = []
        # Servers that already completed tool discovery (including forbidden-only).
        self._discovered_servers: set[str] = set()
        # Last connect/disconnect error per server (surfaced in get_server_status).
        self._connect_errors: dict[str, str] = {}
        self._started = False
        self._start_lock = asyncio.Lock()
        self._register_lock = asyncio.Lock()
        # Per-server connect locks — prevent lazy + ensure_server double-spawn.
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
            # v2: tool failures surface as JSON-RPC errors — pass the message
            # through so the LLM can self-correct (v1 returned is_error content).
            msg = getattr(exc, "message", None) or str(exc)
            return json.dumps({"error": f"MCP tool error: {msg}"})
        except Exception as exc:
            return json.dumps({"error": _safe_mcp_error(server_name, exc)})

        parts: list[str] = []
        for block in result.content:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
            else:
                parts.append(str(block))
        # Keep is_error for v1-protocol external servers that still return
        # CallToolResult(is_error=True) instead of raising MCPError.
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
        """Invoke once; reconnect+retry only on transport-level failures.

        Application / protocol errors are not retried — avoids double-executing
        non-idempotent tools when the server already applied the side effect.
        """
        try:
            return await asyncio.wait_for(
                conn.session.call_tool(original_name, arguments),  # type: ignore[union-attr]
                timeout=conn.config.call_timeout_seconds,
            )
        except asyncio.TimeoutError:
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
            # Empty when already connected (lazy/ensure race) or server exposed
            # no tools — avoid implying a fresh zero-tool connect.
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
        """Reject SSRF-prone URLs in external MCP tool arguments.

        Validates http(s) strings nested up to a small depth, plus common
        URL-named fields — not only Playwright's ``browser_navigate``.
        ``original_name`` is kept for call-site clarity / future per-tool
        allowlists. DNS runs off the event loop via ``validate_http_url_async``.
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
        """Collect http(s) URL strings from tool arguments (depth-limited walk)."""
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
                # Already connected (e.g. lazy task raced with ensure_server).
                return []

            if existing is not None:
                # Dead session left behind — close before replacing.
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

            # Reconnect after a prior successful discovery (including forbidden-only
            # servers that never entered ``_tool_index``): reuse existing index.
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

                parameters = tool.input_schema if isinstance(tool.input_schema, dict) else {
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
                # Forbidden tools stay in discovered (governance deny) but are
                # not callable via the mesh index.
                if risk != "forbidden":
                    self._tool_index[registered] = (config.name, tool.name)

            self._discovered_servers.add(config.name)
            self._discovered.extend(discovered)
            return discovered

    def list_server_tools(self, server_name: str) -> list[dict[str, str]]:
        """Public read of tools for a connected server (empty if disconnected)."""
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
        """Return connection status for external MCP servers.

        When ``server_name`` is set, returns a single-server dict with
        ``connected`` / ``tool_count`` (plus status fields). Otherwise returns
        the full mesh status payload.
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
