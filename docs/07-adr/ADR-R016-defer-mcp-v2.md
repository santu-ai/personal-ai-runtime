# ADR-R016 — 迁移至 mcp 2.0.0

| Field | Content |
|-------|---------|
| Decision | 升级到 `mcp==2.0.0`；客户端 [`mcp_mesh.py`](../../backend/app/core/harness/mcp_mesh.py) 适配 snake_case 字段 + 显式捕获 `MCPError`；服务端 [`server.py`](../../backend/mcp_servers/runtime_gateway/server.py) 从 `FastMCP` 迁到 `MCPServer`；保留 owner-task 生命周期以规避 anyio cancel-scope 跨 task 退出 |
| Context | 原 ADR（暂缓）记录的阻塞——cryptography openssl-sys 源码编译失败——在 Python 3.13 + 当前依赖链下已消失（`pip install --dry-run mcp==2.0.0` 全部预编译 wheel）。mcp 2.0.0 对齐 2026-07-28 MCP 规范：`FastMCP`→`MCPServer`、`httpx`/`httpx-sse`→`httpx2`、协议类型字段 camelCase→snake_case、`McpError`→`MCPError`、超时参数 timedelta→float。Dependabot 分支只改版本号未处理 breaking changes，不可直接合并；本次专门迁移 PR 一次性完成代码 + 依赖锁 + ADR 翻转 |
| Evidence | mcp v2 迁移指南（`py.sdk.modelcontextprotocol.io/v2/migration/`）；本地 dry-run 依赖链可解析；`ClientSession`/`stdio_client`/`StdioServerParameters` 公共 API 表面不变，owner-task 模式兼容 |
| Consequences + | 获得 2026-07-28 spec 对齐与新 API；依赖链可验证安装；工具错误经 `MCPError` 原文回传供 LLM 自纠 |
| Consequences − | v1.x 进入纯维护期；外部仍走 v1 协议的 stdio server 依赖 v2 client 的 `mode='auto'` 回退握手；`requirements.lock` 新增 `httpx2`/`mcp-types`/`truststore`/`PyJWT` |
| Still valid? | N/A（决策已执行） |

**迁移要点**（已落地）：
1. `tool.inputSchema` → `tool.input_schema`；`result.isError` → `result.is_error`（保留 `is_error` 分支以兼容 v1 协议外部 server）
2. `call_tool` 外层新增 `except MCPError`，回传 `exc.message` 原文
3. `from mcp.server.fastmcp import FastMCP` → `from mcp.server.mcpserver import MCPServer`；`version=` 构造参数替代 `_apply_server_version` 补丁
4. `requirements.lock` 经 `pip-compile --generate-hashes` 重生成
