# 当前数据模型

> 基线：HEAD `61f3e3bc`。本文件满足 schema/document guard，只描述当前 SQLite 实现；目标 PostgreSQL schema 见[共享云数据与多设备 Runtime 方案](../shared-cloud-runtime-plan.md)。

当前 registry 共 19 张表：15 张 governed 表和 4 张 app storage 表。governed 表由 Kernel 事件与投影维护；app storage 用于本地配置、缓存或恢复坐标。

## GOVERNED

### `work_items`

领域 Work 与 goal 的投影，包含状态、优先级、依赖、计划、进度和 deadline。

### `memories`

记忆事实、置信度、来源、claim 状态和 Chroma embedding 引用。

### `approvals`

高风险能力或交互续跑的审批状态。

### `conversations`

会话标题、摘要和时间。

### `messages`

消息、工具调用、来源与对应事件。

### `notifications`

通知、已读状态、去重键和关联对象。

### `event_log`

append-only 事件日志。当前 `seq` 是 SQLite 自增主键。

### `projection_checkpoints`

投影重建的 checkpoint 和 snapshot。

### `handler_executions`

Scheduler 的 durable execution 投影。当前只保存固定 instance id 和执行状态，没有跨设备 lease/fencing 字段。

### `timer_events`

cron/delay timer 的定义与触发状态。

### `policy_events`

能力策略的当前投影。

### `inbox_emails`

收件箱邮件及分类、重要度、通知和摘要状态。

### `tool_calls`

能力调用的审计投影。

### `llm_calls`

模型调用、token、成本、时延和结果审计。

### `user_profile`

用户 profile 的分类数据与置信度。

## APP_STORAGE

| 表 | 当前用途 | 目标处理 |
|---|---|---|
| `activity_log` | event log 的可读活动缓存 | 可继续作为共享派生投影 |
| `app_settings` | UI、LLM、邮件和 monitor 配置 | 拆为云端共享配置、本机凭据和本机缓存 |
| `memory_index_repairs` | Chroma 索引失败修复队列 | 改造为持久 embedding 重试或并入共享 execution；只删除 Chroma 专用职责 |
| `plan_resumes` | 审批暂停后的续跑坐标与步骤幂等 | 重新归类为共享执行状态 |

## 当前持久化边界

- SQLite schema 由 [schema_ddl.py](../../backend/app/store/schema_ddl.py)和 Alembic 管理。
- 表分类权威来自 [table_registry.py](../../backend/app/store/table_registry.py)。
- Chroma 数据位于 `VECTOR_DIR`，不是共享数据库。
- snapshot/restore 会操作 SQLite、event log 和本地向量目录，属于备份/恢复，不是多设备同步协议。
