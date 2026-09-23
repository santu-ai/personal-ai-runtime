# 后端 API 层

本文档描述后端 HTTP API 层。完整端点签名表见 [06-reference/api-endpoints.md](../06-reference/api-endpoints.md)；本文聚焦结构与流程。

## 应用入口

[`backend/app/main.py`](../../backend/app/main.py) 是 FastAPI 入口：`FastAPI(title="Personal AI Runtime", version=VERSION, lifespan=lifespan)`（[`main.py`](../../backend/app/main.py)）。

### 路由挂载

14 个 router 在 [`main.py`](../../backend/app/main.py) 挂载：

```
chat, dashboard, system, settings_api, memory, notifications,
telemetry_api, approvals, triggers, inbox, monitors,
connectors, timeline, work_items
```

### 中间件（外到内）

1. **`RequestIDMiddleware`**（[`main.py`](../../backend/app/main.py)）— 读取或生成 `X-Request-ID`（uuid4 前 16 位），存入 `request_id_var` ContextVar，响应头回写。
2. **`CORSMiddleware`**（[`main.py`](../../backend/app/main.py)）— `allow_origins=settings.cors_origins.split(",")`、`allow_credentials=True`、方法 `GET/POST/PUT/PATCH/DELETE/OPTIONS`、头 `Authorization/Content-Type/X-Request-ID`。
3. **`AuthMiddleware`**（[`main.py`](../../backend/app/main.py)）— 纯 ASGI Bearer Token 中间件（刻意避开 `BaseHTTPMiddleware` 以免缓冲 SSE）。详见 [05-engineering/security.md](../05-engineering/security.md)。

## 生命周期

`lifespan(app)`（[`main.py`](../../backend/app/main.py)）：

**Startup**：

1. `acquire_instance_lock()`（单实例文件锁）
2. `run_startup_checks()` → 快照
2. AUTH_TOKEN 安全策略：未设且非 localhost bind 且未开 `ALLOW_NO_AUTH_ON_EXPOSED` → `sys.exit(1)`
3. `init_scheduler()` — 注册 cron + 任务依赖订阅
4. `capability_governance.seed_from_json(kernel)` — 从 [`capability_policy.json`](../../backend/capability_policy.json) 播种 `PolicyCreated`
5. `await runtime_loop.start()` — 统一循环
6. `await start_mcp_mesh()` — 连接 stdio MCP servers
7. `enrich_with_mcp_status(...)`
8. 若裸奔运行，启动 600s 周期安全告警协程

关闭段包在 `try/finally` 里，每步 best-effort，**最后**释放单实例锁：

1. `await stop_mcp_mesh()`
2. 取消周期性 auth warning
3. `await runtime_loop.stop()`
4. `shutdown_scheduler()`（cron）
5. 关闭所有 WebSocket
6. `release_instance_lock()`

## 端点分类速览

按职责分组（详见 [06-reference/api-endpoints.md](../06-reference/api-endpoints.md)）：

| Router | prefix | 关键端点 | 副作用类型 |
|---|---|---|---|
| chat | `/api/chat` | 会话 CRUD、`POST /conversations/{id}/messages`（**SSE**）、`POST /chat/approvals/{id}/resolve` | Kernel 事件 + LLM + 工具执行 |
| memory | `/api/memory` | memories CRUD、search、ratify/reject/contest、portrait、graph | Kernel 事件 + Chroma |
| work_items | `/api/work-items` | 统一 goal/task/action CRUD、`include=`、`decompose`、项目简报创建、交付列表/验收/返工、建议待办转任务、`GET /delivery-metrics?days=`（1–365，默认 30；首版采纳、返工、已转任务、评审耗时；审批与恢复按交付 `execution_id` 关联既有事件，读上限打满时为 unavailable；模型成本汇总能关联到该执行的金额；缺少 `caused_by` 的成功 `project_brief` 调用另计 `unattributed_project_brief_calls`，其金额合计为 `unattributed_project_brief_cost`，不并入已归因金额，也不把已归因金额改成 unavailable；读上限打满时已归因金额、未归因次数和未归因金额都是 unavailable。交付包每个版本带 `latest_decision`，含已存储的返工 `reason`；没有决定时为 null） | Kernel 事件 + LLM |
| approvals | `/api/approvals` | 列表、`/{id}/approve`、`/{id}/reject` | `submit_command("ApproveRequested")` + 工具执行 |
| inbox | `/api/inbox` | 列表默认 `status=all`（邮箱全量）；`status=pending` 为未读分拣；`/poll`（IMAP）、`/digest`、状态更新 | 网络出口 + Kernel 事件 |
| monitors | `/api/monitors` | 收件箱过滤器 CRUD、URL 变化监控 CRUD、`POST /url-monitors/check` | APP_STORAGE + 出站抓取 |
| triggers | `/api/triggers` | CRUD | Kernel 事件 |
| notifications | `/api/notifications` | 列表、`/{id}/read`、`/read-all` | Kernel 事件 |
| dashboard | `/api/dashboard` | `GET /`、`GET /periods?days=`（1–30，默认 7；近 N 日 vs 前 N 日：完成目标、完成任务、新邮件、采纳率；投影缺失的完成记 `work_completed_untyped`；从既有事件重建） | **只用 Kernel ABI**（一致性测试床） |
| system | `/api/system` | health/live/ready/info/mcp-status、export/import/encrypted、`DELETE /data`、`POST /morning-brief/test`（诊断生成早安简报，正文含同一周期对比） | 数据主权（含破坏性）+ 诊断 |
| settings_api | `/api/settings` | llm GET/PUT/test、email GET/PUT/test、prompt GET/PUT、notifications | DB 写 + 网络出口 + 文件写 |
| telemetry_api | `/api/telemetry` | cost/summary/by-model、llm-calls、tool-calls、tool-summary、memory/stats、health、governance（`adoption`：工具建议采纳 + 记忆确认；通过/拒绝/过期读 `ApprovalGranted` / `ApprovalDenied`，`auto_allow` 与 `auto_expired` 不进采纳率） | 只读 |
| timeline | `/api/timeline` | `/events`（分页 + 中文标签） | 只读 event_log |
| connectors | `/api/connectors` | 列表、详情、test、registry、install、uninstall | 可能进程间/网络 + 文件写 |

## SSE 流式端点

**唯一 SSE 端点**：`POST /api/chat/conversations/{conv_id}/messages`（[`chat.py`](../../backend/app/api/chat.py)），`text/event-stream`。

事件类型：`text_delta`、`tool_call_start`、`tool_result`、`sources`、`confirmation_required`、`done`、`error`、`ping`（15s 心跳）。

实现细节（[`chat.py`](../../backend/app/api/chat.py)）：

- 内部生成 `correlation_id = "chat_" + uuid[:12]`，从 `notification_bridge`（SSE queue registry）注册内存队列。
- 上限 `settings.total_tool_loop_timeout + 10s`；超时返回 `error`。
- 既监听 SSE 队列，也回退查询 `event_log` 中的 `ChatDone`/`ChatCompleted`。
- 响应头：`Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`（禁用 nginx 缓冲）。

`AuthMiddleware` 刻意设计为纯 ASGI 中间件以避免 `BaseHTTPMiddleware` 缓冲整段响应体。

## WebSocket 端点

`WS /ws`（[`main.py`](../../backend/app/main.py)）— 实时通知推送。

- 鉴权：`Sec-WebSocket-Protocol: auth.<token>` 子协议（[`main.py`](../../backend/app/main.py)），失败关闭码 4401，成功回 `auth.ok`。
- 行为：维持连接列表，接收客户端 `ping` 回 `pong`。
- `broadcast_notification(event)`（[`main.py`](../../backend/app/main.py)）向所有连接广播 JSON，自动清理已断开连接。

无其他 WebSocket 端点。

## 数据访问层

### `backend/app/store/`

| 文件 | 职责 |
|---|---|
| [`database.py`](../../backend/app/store/database.py) | `Database` 单例，SQLite + WAL + `synchronous=NORMAL`；线程局部连接缓存；`get_db()` contextmanager 自动 commit/rollback；`wal_checkpoint`；`log_activity` |
| [`schema_init.py`](../../backend/app/store/schema_init.py) | `ensure_schema(db)`：生产路径跑 Alembic，测试/自定义路径跑原始 DDL |
| [`alembic_runner.py`](../../backend/app/store/alembic_runner.py) | `run_migrations()` 用 `backend/alembic.ini`，`command.upgrade(cfg, "head")`，幂等 |
| [`schema_ddl.py`](../../backend/app/store/schema_ddl.py) | raw DDL fallback：应用表 + kernel 表 + 投影表（`event_log`、`projection_checkpoints`、`handler_executions`、`timer_events`、`policy_events`） |
| [`table_registry.py`](../../backend/app/store/table_registry.py) | 表分类（GOVERNED vs APP_STORAGE）+ `GOVERNED_SCHEMA` 契约。详见 [02-concepts/kernel-boundary.md](../02-concepts/kernel-boundary.md) |
| [`vector.py`](../../backend/app/store/vector.py) | `VectorStore` 单例，ChromaDB `PersistentClient(path=settings.vector_dir)`，关闭 telemetry 并 monkey-patch `posthog.capture`。单个 collection：`memories` |

## Product 层

[`backend/app/product/`](../../backend/app/product/)：

| 文件 | 模块 | 职责 |
|---|---|---|
| [`inbox.py`](../../backend/app/product/inbox.py) | `poll_inbox`/`generate_inbox_digest`/`list_inbox_emails`/`mark_inbox_email_status`/`latest_digest`/`apply_inbox_poll_payload`/`inbox_sync_status` | 邮件应用层：经 `kernel.invoke_capability("check_inbox")` 或 `submit_command("InboxPollRequested")` 拉**最近邮件（含已读，最多 20 封正文）**并用 UNSEEN 索引同步已读；LLM 分类；emit `InboxEmailRecorded`（投影由 [`projectors_inbox.py`](../../backend/app/core/runtime/kernel/projectors_inbox.py) 写入 `inbox_emails`）；为 important 邮件推通知；每日摘要幂等；poll 后求值收件箱过滤器；`inbox_sync_status` 从 `InboxPollCompleted` 重建最近同步时间/结果/失败原因与 7 日指标 |
| [`inbox_monitors.py`](../../backend/app/product/inbox_monitors.py) / [`url_monitors.py`](../../backend/app/product/url_monitors.py) | 过滤器/URL 监控 CRUD + 求值 | 配置在 `app_settings.monitors`；匹配或正文 hash 变化时经 `dedup_key` 推通知；URL 抓取走 SSRF-safe `FetchServer` |
| 数据主权（`Kernel.snapshot`/`restore`/`erase`） | Kernel 内置方法（[`kernel_sovereignty.py`](../../backend/app/core/runtime/kernel/kernel_sovereignty.py)） | 数据主权：`snapshot()`/`restore()`/`erase()`；删 SQLite + vector 目录并重建；export_all/import_all 由 `/api/system/*` 路由直接调用 Kernel |
| [`encrypted_sync.py`](../../backend/app/product/encrypted_sync.py) | `encrypt_snapshot`/`decrypt_snapshot` + `EncryptedSyncError` | AES-GCM + Argon2id（V2）；blob 布局 `[4B magic 'PAES'][1B version=2][16B salt][12B nonce][zlib+AES-GCM ciphertext]` base64；`BLOB_FORMAT = "encrypted_snapshot_v2"`；最小密码 8 字符 |
| [`personal_dashboard.py`](../../backend/app/product/personal_dashboard.py) | `generate_dashboard` + 5 个 `_widget_*` | 一致性测试床：每个 widget 仅用 Kernel ABI / `read_ports`（`query_state`/`read_events`/`recall_memories_for_context`），零 SQL、零文件、零 ChromaDB 直访；记忆 widget 排除 proposed/rejected/contested |
| [`work_delivery.py`](../../backend/app/product/work_delivery.py) | `publish_delivery` / `accept_delivery` / `request_rework` / `adopt_suggested_action` / `summarize_delivery_metrics` | 交付版本、验收/返工、建议待办转任务，以及近 N 日简报评审汇总：折叠 `WorkItemUpdated` payload，并把审批（该执行 correlation 上的高风险 `ApprovalRequested`，以及 `caused_by` 指向该执行的 `CapabilityDenied`）、崩溃恢复和模型成本关联到交付的 `execution_id`（既有事件，无新事件类型或投影表）。同一次中断的 handler replay（`ExecutionRetried(reason=interrupted, status=retrying)` 或 `ExecutionFailed(error=interrupted)`；随后的 `status=pending` 重放不另计）与带同一执行、同一 `retry_count` 的 `CapabilityFailed(error=interrupted_before_audit)` 只计一次恢复。补发事件的 `caused_by`、`execution_id` 和 `retry_count` 来自调用当时的 ScheduledExecution；没有这些字段的旧事件仍按 correlation 并入已有 handler replay。模型成本只加总 `caused_by` 指向这些执行且成功的 `LLMCallRecorded`（`purpose=project_brief`）；缺少 `caused_by` 的成功调用计入 `unattributed_project_brief_calls`，其金额合计为 `unattributed_project_brief_cost`，不并入已归因金额。读上限打满时审批、恢复、模型成本、该次数和该金额为 unavailable。每个交付版本的读取带上该版本最新 `delivery_decision`（`latest_decision`，含 `reason`） |
| [`project_brief.py`](../../backend/app/product/project_brief.py) | `create_project_brief_work` / `compile_project_brief_delivery` | 项目资料简报模板：来源收集、引用校验、发布完整交付；经 RuntimeContainer 绑定给 ExecuteRequested |
| [`morning_brief.py`](../../backend/app/product/morning_brief.py) | `generate_morning_brief` | 08:00 cron 与 `POST /api/system/morning-brief/test` 共用。通知按本地日期分桶；正文附 `read_ports.compare_periods(days=7)`，该段失败时降级为「获取失败」 |

## 直接访问 DB 的端点

绝大多数 router 通过 Kernel ABI。例外（直访 APP_STORAGE / 文件，或经 product 写非 governed 存储）：

- [`connectors.py`](../../backend/app/api/connectors.py) 的 install/uninstall — 写 [`mcp_config.json`](../../backend/mcp_config.json)

`inbox_emails` 是 GOVERNED 投影：[`product/inbox.py`](../../backend/app/product/inbox.py) 写经 `emit_event`，读经 `read_ports`。

## 请求/响应模型

所有 Pydantic 模型定义于 [`backend/app/api/models.py`](../../backend/app/api/models.py)（如 `SendMessageRequest`、`CreateConversationRequest`、`ResolveApprovalRequest`（`decision` 必须显式为 `approve`/`deny`，缺省 422）、`CreateMemoryRequest`、`UpdateMemoryRequest`（category 必须在 `{fact, preference, habit, belief, insight, work, personal}`）、`CreateTriggerRequest`、`ExportRequest`/`ImportRequest`/`EncryptedExportRequest`/`EncryptedImportRequest`、`UpdateInboxStatusRequest`、`LlmProviderInput`/`UpdateLlmConfigRequest`/`UpdateEmailConfigRequest`/`TestEmailRequest`/`TestLlmRequest`/`PromptConfig`/`NotificationSettings`、`InstallConnectorRequest`）。Work item 请求体定义在 [`work_items.py`](../../backend/app/api/work_items.py)。

确认码常量（[`system.py`](../../backend/app/api/system.py)）：`EXPORT_CONFIRM="EXPORT_ALL_DATA"`、`DESTROY_CONFIRM="DESTROY_ALL_DATA"`、`IMPORT_CONFIRM="DESTROY_AND_IMPORT"`。
