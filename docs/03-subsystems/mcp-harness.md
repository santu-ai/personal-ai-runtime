# MCP 工具框架

本文档描述内建工具注册与外部 MCP（Model Context Protocol）服务器网格——LLM agent 调用的所有能力的载体。

## MCPHub — 工具注册与调用中心

[`backend/app/core/harness/mcp_hub.py`](../../backend/app/core/harness/mcp_hub.py) 是工具注册、发现、调用的中央 hub，支持同步与异步 handler。

### 工具分类

| 常量 | 行 | 内容 |
|---|---|---|
| `CORE_CATEGORIES` | [`mcp_hub.py`](../../backend/app/core/harness/mcp_hub.py) | time、filesystem、web、calendar、email、shell、git、goals |
| `ADVANCED_CATEGORIES` | [`mcp_hub.py`](../../backend/app/core/harness/mcp_hub.py) | telegram、computer_use、voice、clipboard_ocr（经 `settings.builtin_tool_categories` **叠加** opt-in，不替换 CORE） |

表驱动注册见 [`builtin_registration/`](../../backend/app/core/harness/builtin_registration/)（`BuiltinToolSpec` + `_CATEGORY_BUILDERS`）。许多工具带 `requires_confirmation=True`：`write_file`、`apply_patch`、`add_calendar_event`、`send_email`、`shell_exec`、`telegram_send`、`computer_click`/`type`/`key`。

按 [architecture-principles.md](../02-concepts/architecture-principles.md)：`mcp_hub` / `mcp_mesh` / 安全与注册基础设施属于 Runtime（Capability 载体）；邮件、日历、Telegram 等**领域工具实现**属于 Product 职责——即使当前源码位于 `core/harness/builtin_tools/`，扩展时也不应把产品策略继续堆进 Runtime 原语层。

### Mesh 集成

`register_mesh_tools(discovered)`（[`mcp_hub.py`](../../backend/app/core/harness/mcp_hub.py)）：每个发现的工具包一层 async handler 调 `mcp_mesh.call_tool`，然后经 `capability_governance.register_external_tool(risk=item.policy_risk)` 注册并分类 taint。

### 调用

`invoke_tool(name, args)` — 派发到 handler。纯文本输出 >8000 字符截断；**合法 JSON 保持可解析**（上限 256000 字符，超出则返回 `{"error":"result_too_large"}`），因为 Kernel 消费者（收件箱轮询等）会对结果做 `json.loads`。LLM 侧压缩走 `tool_postprocess.compact_for_llm`，不在此处切坏 JSON。handler 异常 / 超时 / 未知工具抛 `ToolInvokeError`（`tool_execution_failure` / `tool_timeout` / `tool_not_found` / `tool_invalid_result` / `authorization_failure`），由 `Kernel.invoke_capability` 记为 `CapabilityFailed`。禁止把执行失败吞成 JSON 字符串再记 `CapabilityInvoked`。全部内建 handler（filesystem / git / fetch / shell / web_search / email IMAP-SMTP / calendar / timer / goals / telegram / computer_use / voice / clipboard_ocr）与 `mcp_mesh.call_tool` 的失败路径同样抛 `ToolInvokeError`。空收件箱 / 找不到 Message-ID 等应用层 miss 仍可返回 JSON。按 Message-ID 读信时 IMAP/凭据失败抛 `ToolInvokeError`，不得当成 miss。

公开接口：`get_tool_defs_for_llm()`、`get_tool`、`needs_confirmation`、`is_async`、`invoke_tool`、`register_tool`、`unregister_tool`。

## MCP 配置加载

[`backend/app/core/harness/mcp_config.py`](../../backend/app/core/harness/mcp_config.py) 加载并校验 [`backend/mcp_config.json`](../../backend/mcp_config.json)。

`ExternalMCPServerConfig` dataclass 的策略字段：

| 字段 | 含义 |
|---|---|
| `policy_default` | `auto_allow` / `needs_user` / `forbidden` |
| `needs_user_tools` | 需用户审批的工具子集 |
| `needs_user_patterns` | 需审批的工具名模式 |
| `ingestion_tools` | 外部摄入工具（触发 taint） |
| `ingestion_patterns` | 摄入工具名模式 |
| `required_env` / `optional_env` | 必需/可选环境变量 |
| `enabled_tools` | 工具白名单 |
| `startup_connect` | 启动时连接（否则懒连接） |
| `connect_timeout_seconds` / `call_timeout_seconds` | 超时 |

`resolve_env()` 合并 settings_env（`BRAVE_API_KEY`、`CONTEXT7_API_KEY`、`GITHUB_PAT`、`TAVILY_API_KEY`、`NOTION_TOKEN`）。

## MCPMesh — Stdio 生命周期

[`backend/app/core/harness/mcp_mesh.py`](../../backend/app/core/harness/mcp_mesh.py) 管理 stdio MCP 服务器连接与工具发现。

### `_ServerConnection`（[`mcp_mesh.py`](../../backend/app/core/harness/mcp_mesh.py)）

`connect()` 用 `stdio_client(StdioServerParameters)` + `ClientSession`，调 `initialize()` + `list_tools()` 带超时。

### `MCPMesh`（[`mcp_mesh.py`](../../backend/app/core/harness/mcp_mesh.py)）

- `start()` 并行连接 startup servers，为 `startup_connect=False` 的服务器 spawn 懒连接后台任务。
- `call_tool(registered_name, arguments)` 经 `url_safety.validate_http_url` 校验 Playwright URL 工具；失败抛 `ToolInvokeError`（未知工具 / 禁止 / 超时 / 执行失败），不返回 JSON error 字符串。
- `get_server_status()` 报告每服务器 connected/lazy/disconnected/unavailable。

### 发现

`_connect_server` 为每个暴露工具构建 `DiscoveredMCPTool`，`policy_risk` 从 config 派生（`forbidden`/`high`/`low`）。工具名经 `external_tool_id(prefix, tool_name)` 规范化以防碰撞。

## MCP 生命周期钩子

[`backend/app/core/harness/mcp_lifecycle.py`](../../backend/app/core/harness/mcp_lifecycle.py) 是 FastAPI harness 钩子：`start_mcp_mesh()` / `stop_mcp_mesh()`。在 [`main.py`](../../backend/app/main.py) lifespan 调用。启动失败仅记日志，不阻断应用。

## 内建工具模块

[`backend/app/core/harness/builtin_tools/`](../../backend/app/core/harness/builtin_tools/) 各模块暴露 `*_server` 对象，handler 函数被 `MCPHub._register_*_tools` 消费：

| 模块 | 用途 |
|---|---|
| `filesystem` | 读/写/列目录/apply_patch（受 `filesystem_allowed_dirs`/`filesystem_protected_paths` 限制） |
| `web_search` | DuckDuckGo 免费搜索兜底（有 key 时可用外部 brave/tavily） |
| `fetch` | URL 抓取（SSRF 校验） |
| `calendar` | 本地 ICS 日历 |
| `email` | IMAP 读 / SMTP 发 |
| `shell` | shell 命令执行 |
| `git` | 本地 git status/log/diff |
| `goals` | 目标/任务操作 |
| `telegram_bot` | Telegram 消息（高级，opt-in） |
| `computer_use` | 截图/点击/输入/按键（高级，opt-in） |
| `voice` | TTS/STT（高级，opt-in） |
| `clipboard_ocr` | 剪贴板/OCR（高级，opt-in） |

浏览器自动化由外部 MCP `@playwright/mcp` 提供，不再内建 `browser` 模块。

## 外部 MCP 配置文件

完整工具/策略表见自动生成的 [tool-catalog.md](../06-reference/tool-catalog.md)（由 `capability_policy.json` / `mcp_registry.json` / `mcp_config.json` 生成，勿手工复制）。

### `backend/mcp_config.json`

声明外部 MCP server，全部 `type: stdio`、`enabled`、可选 `startup_connect`、`command`/`args`（均 `npx -y <pkg>`）、每服务器工具白名单（`enabled_tools`/`needs_user_tools`/`ingestion_tools`）、`policy_default`。当前仓库内置清单与策略以 [tool-catalog.md](../06-reference/tool-catalog.md) 为准。

### `backend/mcp_registry.json`

用户面向 UI 目录，镜像同样的服务器，附中文描述、类别、安装命令（**与 `mcp_config.json` 同 pin**）、中文环境变量提示、图标名，以及安装时写入 `mcp_config` 的运行时字段。是可安装 MCP marketplace 元数据；`env_vars` 仅作 UI 提示，不会写入运行时 `env`。目录表见 [tool-catalog.md](../06-reference/tool-catalog.md)。

### `mcp_config.local.json`（个人 opt-in，gitignored）

`_merge_external_servers` 按 `name` 把 local 条目叠加在 main 之上，让个人/团队专属 MCP 不进仓库。模板见 [`mcp_config.local.json.example`](../../backend/mcp_config.local.json.example)：copy 为 `mcp_config.local.json` 并按需启用。凭据统一来自 `.env`（经 [`mcp_config.py`](../../backend/app/core/harness/mcp_config.py) 的 `resolve_env` 注入子进程），未填 `required_env` 的服务器保持 dormant（`is_available()` 返 `False`，不报错）。

| Server | 用途 | 环境变量 |
|---|---|---|
| **tapd** | 腾讯 TAPD — 需求/Bug/任务只读查询 | `TAPD_ACCESS_TOKEN`（必需）、`TAPD_DEFAULT_WORKSPACE_ID`/`TAPD_NICK_NAME`（可选） |
| **tushare** | 中国金融数据 — A股/港美股/基金/宏观/财经新闻（`aigroup-market-mcp`） | `TUSHARE_TOKEN`（必需） |

新增带凭据的 local MCP 时，必须在 `resolve_env()` 与 `has_required_credentials()` 的 `settings_env` 字典里各加一行映射，否则 token 传不进子进程。

## 与治理的集成

工具调用流程参见 [02-concepts/capability-governance.md](../02-concepts/capability-governance.md)：

1. Brain 经 `ToolDispatcher` 调 `kernel.invoke_capability(name, args, execution_id)`。
2. Kernel 走 3-gate，外部 MCP 工具的 `policy_risk` 来自 [`mcp_config.json`](../../backend/mcp_config.json)。
3. 允许后 Kernel 调 `mcp_hub.invoke_tool` → 内建 handler 或 `mcp_mesh.call_tool`。
4. 摄入类工具成功后 taint `correlation_id`。

## 安全相关

- URL 工具经 `url_safety.validate_http_url` 防 SSRF（详见 [05-engineering/security.md](../05-engineering/security.md)）。
- `filesystem` 受 `FILESYSTEM_ALLOWED_DIRS`/`FILESYSTEM_PROTECTED_PATHS` 限制；写保护路径默认含 `kernel/`、`policy`、`taint.py`、`.env*`、`.git/`（见 [`coding_rules.md`](../../backend/prompts/coding_rules.md)）。
- 高级类别（computer_use/voice/clipboard_ocr）需显式 `BUILTIN_TOOL_CATEGORIES` opt-in。
