# ADR-R016 — 暂缓 mcp 2.0.0 迁移（钉住 mcp==1.28.1）

| Field | Content |
|-------|---------|
| Decision | 保持 `mcp==1.28.1`（v1.x 维护分支），**暂不迁移**到 mcp 2.0.0；Dependabot 的 mcp-2.0.0 PR 关闭/驳回 |
| Context | mcp 2.0.0 是跨 major 重构（对齐 2026-07-28 MCP 规范）：`FastMCP` 改名 `MCPServer`、`httpx`/`httpx-sse` 替换为 `httpx2`、`Tool` 等类型字段 camelCase→snake_case、`McpError`→`MCPError`、超时参数 timedelta→float、sync handler 改跑 worker 线程。本仓库 `mcp_mesh.py`（客户端）+ [`server.py`](../../backend/mcp_servers/runtime_gateway/server.py)（FastMCP 服务端）均直接依赖其 API；且 v2 依赖链（cryptography 编译、sse-starlette 3.x、opentelemetry-api、mcp-types）在本地 Python 3.12 环境出现 wheel 编译阻塞。v1.x 仍受维护（安全修复），官方建议未 ready 时保持 `<2` 上限 |
| Evidence | Dependabot PR `dependabot/pip/backend/mcp-2.0.0`；mcp v2 迁移指南（`py.sdk.modelcontextprotocol.io/v2/migration/`）；本地 `pip install mcp==2.0.0` 因 cryptography openssl-sys 编译失败 |
| Consequences + | 依赖稳定可验证；v1.x 持续收安全补丁；Dependabot PR 有明确驳回依据 |
| Consequences − | 无法获得 v2 的规范对齐与新 API（2026-07-28 spec）；未来迁移需专门 PR 一次性处理 `mcp_mesh.py` + [`server.py`](../../backend/mcp_servers/runtime_gateway/server.py) + 依赖链 |
| Still valid? | Yes until a dedicated migration PR lands |

**迁移触发条件**（满足任一即可启动专门迁移）：
1. v1.x 停止安全维护，或
2. 需要 mcp v2 的协议特性（2026-07-28 spec 对齐），且 CI 能验证依赖链安装
