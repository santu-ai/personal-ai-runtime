"""SSRF regression tests for fetch MCP server."""

import pytest

from app.core.harness.builtin_tools.fetch import fetch_server
from app.core.harness.mcp_hub import ToolInvokeError


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/",
        "http://192.168.0.1/",
    ],
)
async def test_fetch_blocks_internal_urls(url: str):
    with pytest.raises(ToolInvokeError, match="Blocked URL"):
        await fetch_server.fetch_url(url)
