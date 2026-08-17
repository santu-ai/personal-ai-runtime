# API 端点参考

> **自动生成** — 由 [`scripts/gen_api_docs.py`](../../backend/scripts/gen_api_docs.py) 从 FastAPI OpenAPI schema 生成。
> 不要手工编辑本文件的端点表。重新生成：`cd backend && python -m scripts.gen_api_docs`。

全端点签名表。认证说明：所有端点（除标 `public`）在 `AUTH_TOKEN` 配置时经全局 `AuthMiddleware` Bearer 校验；**没有任何端点用 FastAPI Depends 式 AUTH_TOKEN 依赖**。

跳过认证路径见 [`main.py`](../../backend/app/main.py) 的 `SKIP_AUTH_EXACT` / `SKIP_AUTH_PREFIXES`（生成时直接引用这两个常量，避免手工清单漂移）。

另有 WebSocket：`WS /ws`（[`main.py`](../../backend/app/main.py)）—— OpenAPI 不收录 WebSocket，此处手工列出。

## approvals — `/api/approvals`（[`api/approvals.py`](../../backend/app/api/approvals.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/approvals/` | auth | public | List Approvals |
| GET | `/api/approvals/{approval_id}` | auth | — | Get Approval |
| POST | `/api/approvals/{approval_id}/approve` | auth | — | Approve |
| POST | `/api/approvals/{approval_id}/reject` | auth | — | Reject |

## chat — `/api/chat`（[`api/chat.py`](../../backend/app/api/chat.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| POST | `/api/chat/approvals/{approval_id}/resolve` | auth | — | Resolve Approval |
| GET | `/api/chat/conversations` | auth | — | List Conversations |
| POST | `/api/chat/conversations` | auth | — | Create Conversation |
| DELETE | `/api/chat/conversations/{conv_id}` | auth | — | Delete Conversation |
| GET | `/api/chat/conversations/{conv_id}` | auth | — | Get Conversation |
| PATCH | `/api/chat/conversations/{conv_id}` | auth | — | Update Conversation |
| GET | `/api/chat/conversations/{conv_id}/messages` | auth | — | Get Messages |
| POST | `/api/chat/conversations/{conv_id}/messages` | auth | — | Send Message |

## connectors — `/api/connectors`（[`api/connectors.py`](../../backend/app/api/connectors.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/connectors/` | auth | — | List Connectors |
| POST | `/api/connectors/install` | auth | — | Install New Connector |
| GET | `/api/connectors/registry` | auth | — | List Registry |
| POST | `/api/connectors/uninstall` | auth | — | Uninstall Connector |
| GET | `/api/connectors/{connector_name}` | auth | — | Get Connector |
| POST | `/api/connectors/{connector_name}/test` | auth | — | Test Connector |

## dashboard — `/api/dashboard`（[`api/dashboard.py`](../../backend/app/api/dashboard.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/dashboard` | auth | — | Get Dashboard |

## inbox — `/api/inbox`（[`api/inbox.py`](../../backend/app/api/inbox.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/inbox/` | auth | — | Get Inbox |
| GET | `/api/inbox/digest` | auth | — | Get Digest |
| POST | `/api/inbox/digest` | auth | — | Trigger Digest |
| POST | `/api/inbox/poll` | auth | — | Trigger Poll |
| GET | `/api/inbox/sync-status` | auth | — | Get Sync Status |
| GET | `/api/inbox/{email_id}` | auth | — | Get Inbox Email |
| PATCH | `/api/inbox/{email_id}/status` | auth | — | Update Inbox Status |
| GET | `/api/inbox/{email_id}/summary` | auth | — | Get Inbox Email Summary |

## memory — `/api/memory`（[`api/memory.py`](../../backend/app/api/memory.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/memory/graph` | auth | — | Get Memory Graph |
| GET | `/api/memory/memories` | auth | — | List Memories |
| POST | `/api/memory/memories` | auth | public | Create Memory |
| POST | `/api/memory/memories/claims/bulk` | auth | — | Bulk Claim Action |
| GET | `/api/memory/memories/claims/stats` | auth | — | Claim Conversion Stats |
| GET | `/api/memory/memories/count` | auth | — | Count Memories |
| GET | `/api/memory/memories/grouped` | auth | — | List Memories Grouped |
| GET | `/api/memory/memories/search` | auth | public | Search Memories |
| DELETE | `/api/memory/memories/{memory_id}` | auth | — | Delete Memory |
| PUT | `/api/memory/memories/{memory_id}` | auth | — | Update Memory |
| POST | `/api/memory/memories/{memory_id}/contest` | auth | — | Contest Memory |
| GET | `/api/memory/memories/{memory_id}/provenance` | auth | — | Get Memory Provenance |
| POST | `/api/memory/memories/{memory_id}/ratify` | auth | — | Ratify Memory |
| POST | `/api/memory/memories/{memory_id}/reject` | auth | — | Reject Memory |
| GET | `/api/memory/portrait` | auth | — | Get Portrait |

## monitors — `/api/monitors`（[`api/monitors.py`](../../backend/app/api/monitors.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/monitors/inbox-filters` | auth | — | List Inbox Filters |
| POST | `/api/monitors/inbox-filters` | auth | — | Create Inbox Filter |
| DELETE | `/api/monitors/inbox-filters/{filter_id}` | auth | — | Delete Inbox Filter |
| PATCH | `/api/monitors/inbox-filters/{filter_id}` | auth | — | Update Inbox Filter |
| GET | `/api/monitors/url-monitors` | auth | — | List Url Monitors |
| POST | `/api/monitors/url-monitors` | auth | — | Create Url Monitor |
| POST | `/api/monitors/url-monitors/check` | auth | — | Check Url Monitors |
| DELETE | `/api/monitors/url-monitors/{monitor_id}` | auth | — | Delete Url Monitor |
| PATCH | `/api/monitors/url-monitors/{monitor_id}` | auth | — | Update Url Monitor |

## notifications — `/api/notifications`（[`api/notifications.py`](../../backend/app/api/notifications.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/notifications/` | auth | — | List Notifications |
| PUT | `/api/notifications/read-all` | auth | — | Mark All As Read |
| GET | `/api/notifications/unread-count` | auth | internal | Unread Count |
| PUT | `/api/notifications/{notification_id}/read` | auth | — | Mark As Read |

## root — `/`（[`main.py`](../../backend/app/main.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/` | public | — | Root |

## settings — `/api/settings`（[`api/settings_api.py`](../../backend/app/api/settings_api.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/settings/capability-policy` | auth | — | Get Capability Policy |
| GET | `/api/settings/email` | auth | — | Get Email Settings |
| PUT | `/api/settings/email` | auth | — | Update Email Settings |
| POST | `/api/settings/email/test` | auth | — | Test Email Connection |
| GET | `/api/settings/llm` | auth | — | Get Llm Settings |
| PUT | `/api/settings/llm` | auth | — | Update Llm Settings |
| POST | `/api/settings/llm/test` | auth | — | Test Llm Connection |
| GET | `/api/settings/notifications` | auth | internal | Get Notification Settings |
| PUT | `/api/settings/notifications` | auth | internal | Update Notification Settings |
| GET | `/api/settings/prompt` | auth | — | Get Prompt Config |
| PUT | `/api/settings/prompt` | auth | — | Update Prompt Config |

## system — `/api/system`（[`api/system.py`](../../backend/app/api/system.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| DELETE | `/api/system/data` | auth | — | Destroy All Data |
| GET | `/api/system/demo/model-continuity` | auth | — | Model Continuity Demo |
| POST | `/api/system/export` | auth | — | Export All Data |
| POST | `/api/system/export/encrypted` | auth | — | Export Encrypted |
| GET | `/api/system/health` | public | — | Health Check |
| POST | `/api/system/import` | auth | — | Import All Data |
| POST | `/api/system/import/encrypted` | auth | — | Import Encrypted |
| GET | `/api/system/info` | auth | — | System Info |
| GET | `/api/system/live` | public | — | Liveness |
| GET | `/api/system/llm-providers` | auth | — | List Llm Providers |
| GET | `/api/system/mcp-status` | auth | — | Mcp Status |
| POST | `/api/system/morning-brief/test` | auth | — | Morning Brief Test |
| GET | `/api/system/ready` | auth | — | Readiness |

## telemetry — `/api/telemetry`（[`api/telemetry_api.py`](../../backend/app/api/telemetry_api.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/telemetry/cost/by-model` | auth | — | Cost By Model |
| GET | `/api/telemetry/cost/summary` | auth | — | Cost Summary |
| GET | `/api/telemetry/governance` | auth | — | Governance Summary |
| GET | `/api/telemetry/health` | auth | — | Health Snapshot |
| GET | `/api/telemetry/llm-calls` | auth | internal | List Llm Calls |
| GET | `/api/telemetry/memory-index-repairs` | auth | — | Memory Index Repairs |
| POST | `/api/telemetry/memory-index-repairs/{repair_id}/retry` | auth | — | Retry Memory Index Repair |
| GET | `/api/telemetry/memory/stats` | auth | — | Memory Stats |
| GET | `/api/telemetry/tool-calls` | auth | internal | List Tool Calls |
| GET | `/api/telemetry/tool-summary` | auth | — | Tool Summary |

## timeline — `/api/timeline`（[`api/timeline.py`](../../backend/app/api/timeline.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/timeline/events` | auth | public | List Timeline Events |

## triggers — `/api/triggers`（[`api/triggers.py`](../../backend/app/api/triggers.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/triggers/` | auth | — | List Triggers |
| POST | `/api/triggers/` | auth | — | Create Trigger |
| DELETE | `/api/triggers/{trigger_id}` | auth | — | Delete Trigger |

## websocket — `/ws`（[`main.py`](../../backend/app/main.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| WEBSOCKET | `/ws` | auth | — | Real-time notification push |

## work-items — `/api/work-items`（[`api/work_items.py`](../../backend/app/api/work_items.py)）

| 方法 | 路径 | 认证 | 契约 | 摘要 |
|---|---|---|---|---|
| GET | `/api/work-items/` | auth | — | List Work Items |
| POST | `/api/work-items/` | auth | — | Create Work Item |
| DELETE | `/api/work-items/{item_id}` | auth | — | Delete Work Item |
| GET | `/api/work-items/{item_id}` | auth | — | Get Work Item |
| PATCH | `/api/work-items/{item_id}` | auth | — | Update Work Item |
| POST | `/api/work-items/{item_id}/cancel` | auth | — | Cancel Work Item |
| GET | `/api/work-items/{item_id}/children` | auth | — | Get Children |
| POST | `/api/work-items/{item_id}/decompose` | auth | — | Decompose Work Item |
| GET | `/api/work-items/{item_id}/events` | auth | — | Get Events |
| POST | `/api/work-items/{item_id}/execute` | auth | — | Execute Work Item |
| POST | `/api/work-items/{item_id}/status` | auth | — | Update Status |
