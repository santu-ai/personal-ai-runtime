"""Small compatibility surface for supported Python MCP SDK generations.

The project lock currently targets the MCPServer API, while developer
installations may still contain the older FastMCP SDK.  Keep version-specific
imports in this module so the mesh and gateway do not each grow their own
fallback logic.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mcp.server.mcpserver import MCPServer
    from mcp.server.mcpserver.exceptions import ToolError
    from mcp.shared.exceptions import MCPError

    MCP_ERROR_TYPES: tuple[type[MCPError], ...]
else:
    try:  # MCPServer SDK generation
        from mcp.server.mcpserver import MCPServer
    except (ImportError, ModuleNotFoundError):  # pragma: no cover - SDK-dependent
        from mcp.server.fastmcp import FastMCP

        class MCPServer(FastMCP):
            """FastMCP compatibility wrapper exposing the gateway API."""

            def __init__(
                self,
                name: str,
                *,
                instructions: str = "",
                version: str = "",
                **kwargs: Any,
            ) -> None:
                super().__init__(name=name, instructions=instructions, **kwargs)
                self.version = version

    try:
        from mcp.shared.exceptions import MCPError

        MCP_ERROR_TYPES = (MCPError,)
    except ImportError:  # MCP 1.x calls this exception ``McpError``.
        from mcp.shared.exceptions import McpError as _McpError
        from mcp.types import ErrorData

        class MCPError(_McpError):
            """Compatibility constructor matching the former MCPError API."""

            def __init__(
                self,
                code: int = -32603,
                message: str = "MCP error",
                *,
                error: ErrorData | None = None,
            ) -> None:
                super().__init__(error or ErrorData(code=code, message=message))

            @property
            def message(self) -> str:
                return self.error.message

        MCP_ERROR_TYPES = (_McpError, MCPError)

    try:
        from mcp.server.mcpserver.exceptions import ToolError
    except (ImportError, ModuleNotFoundError):  # pragma: no cover - SDK-dependent
        from mcp.server.fastmcp.exceptions import ToolError


__all__ = ["MCPServer", "MCPError", "MCP_ERROR_TYPES", "ToolError"]
