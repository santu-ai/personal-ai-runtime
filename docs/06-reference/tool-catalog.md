# 工具与能力目录

> **自动生成** — 由 [`scripts/gen_tool_catalog.py`](../../backend/scripts/gen_tool_catalog.py) 从 `capability_policy.json` / `mcp_registry.json` / `mcp_config.json` 生成。
> 不要手工编辑。重新生成：`cd backend && python -m scripts.gen_tool_catalog`。

## 内建能力策略（`capability_policy.json`）

| 门 | 工具 |
|---|---|
| `auto_allow` | `get_current_time`, `read_file`, `list_directory`, `search_files`, `web_search`, `fetch_url`, `list_calendar_events`, `get_upcoming_events`, `check_inbox`, `read_inbox_email`, `mark_inbox_email_read`, `mark_inbox_email_unread`, `get_clipboard`, `ocr_image`, `git_status`, `git_log`, `git_diff`, `telegram_updates`, `list_active_goals`, `computer_screen_size`, `voice_tts`, `voice_stt`, `set_timer` |
| `needs_user` | `apply_patch`, `write_file`, `add_calendar_event`, `send_email`, `shell_exec`, `telegram_send`, `computer_screenshot`, `computer_click`, `computer_type`, `computer_move`, `computer_scroll`, `computer_key`, `create_goal`, `update_goal_progress`, `complete_goal`, `delete_goal` |
| `external_ingestion` | `check_inbox`, `read_inbox_email`, `web_search`, `fetch_url` |
| `forbidden` | — |

## 外部 MCP 配置（`mcp_config.json`）

| Server | policy_default | enabled_tools | needs_user_tools | required_env |
|---|---|---|---|---|
| brave | `auto_allow` | `brave_web_search` | — | `BRAVE_API_KEY` |
| context7 | `auto_allow` | — | — | — |
| github | `auto_allow` | `search_repositories`, `search_code`, `search_issues`, `get_pull_request`, `get_file_contents`, `list_pull_requests`, `get_pull_request_files`, `get_pull_request_status` | — | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| notion | `auto_allow` | `API-post-search`, `API-retrieve-a-page`, `API-get-block-children`, `API-query-data-source` | — | `NOTION_TOKEN` |
| playwright | `auto_allow` | `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_click`, `browser_type`, `browser_tabs`, `browser_close` | `browser_click`, `browser_type` | — |
| tavily | `auto_allow` | `tavily_search`, `tavily_extract` | — | — |

## MCP Marketplace 元数据（`mcp_registry.json`）

| Server | category | description | install |
|---|---|---|---|
| playwright | `browser` | 浏览器自动化 — 导航页面、截图、点击元素 | `npx -y @playwright/mcp@0.0.78 --headless` |
| brave | `search` | Brave 网页搜索 — 实时检索公开网页信息 | `npx -y @brave/brave-search-mcp-server` |
| context7 | `developer` | 开发文档检索 — 查询库与框架文档 | `npx -y @upstash/context7-mcp` |
| github | `developer` | GitHub 集成 — 仓库、Issue、PR 查询 | `npx -y @modelcontextprotocol/server-github` |
| tavily | `search` | Tavily AI 搜索 — 深度网页检索与内容提取 | `npx -y tavily-mcp@0.2.21` |
| notion | `productivity` | Notion 集成 — 搜索与读取 Notion 页面 | `npx -y @notionhq/notion-mcp-server` |

叙事与集成细节见 [mcp-harness.md](../03-subsystems/mcp-harness.md)。
