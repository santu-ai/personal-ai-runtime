"""MCP mesh 生命周期钩子，供 FastAPI lifespan 挂载启动/关闭。

与 mcp_mesh 本体解耦：应用层只依赖这里的两个入口，便于测试替换。
"""

from __future__ import annotations

import logging

from app.core.harness.mcp_config import mcp_external_enabled
from app.core.harness.mcp_mesh import mcp_mesh

logger = logging.getLogger(__name__)


async def start_mcp_mesh() -> int:
    """连接配置为 startup 的外部 MCP server；惰性 server 在后台连接。"""
    if not mcp_external_enabled():
        return 0
    await mcp_mesh.start()
    return len(mcp_mesh.discovered_tools)


async def stop_mcp_mesh() -> None:
    """断开外部 MCP server 并注销其工具。

    始终调用 ``stop``（幂等），确保运行期切换 ``mcp_external_enabled``
    不会遗留 stdio 子进程或已注册工具。
    """
    await mcp_mesh.stop()
