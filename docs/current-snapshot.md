# 当前实现快照

> 基线：HEAD `61f3e3bc`，检查日期 2026-10-23。本文只描述代码中已经存在的行为。

## 1. 产品形态

Personal AI Runtime 当前是本地优先、单用户、单设备数据库的桌面个人助手：

- [FastAPI 后端](../backend/app/main.py)承载 Kernel、Scheduler、RuntimeLoop、API、MCP 和产品逻辑。
- [React 前端](../frontend/src/main.tsx)提供对话、目标、任务、收件箱、记忆、今日页、设置、审批和时间线。
- [Electron 桌面端](../desktop/main.js)启动本机后端，并将 Web UI 包装为桌面应用。
- 每台机器拥有独立 SQLite、Chroma 和本地文件目录。两台设备启动的是两个互不知情的数据世界。

系统已经具备完整的个人助手骨架，但当前的“一致性边界”是单机进程加单机数据库，不是账号或云端数据空间。

## 2. 已形成的核心能力

### 事件与状态

[Kernel](../backend/app/core/runtime/kernel/kernel.py)是受治理状态的写入口。领域事实先追加到 `event_log`，再在同一数据库事务中更新投影。当前保留了：

- append-only 事件日志和可重建投影；
- conversation、memory、goal/work、approval、notification、inbox 等统一状态；
- `caused_by`、`correlation_id` 和审计事件；
- 投影快照、重建、导入导出和擦除；
- `read_ports` 读边界及 Kernel/产品层边界守卫。

### 执行

[AgentScheduler](../backend/app/core/runtime/agent_scheduler.py)把事件 fan-out 为 `ScheduledExecution`，状态写入 `handler_executions`。它已经支持：

- pending → running → completed/failed；
- 并发上限、内存队列上限、重试和死信；
- 进程重启后的 pending/running 恢复；
- running 超时回收；
- 取消、审批续跑、步骤幂等和交付评审/返工。

这些机制都围绕常量 `runtime:primary` 和单个进程内的 `_pending`、`_active` 集合运行。所谓 lease 是本机超时恢复语义，没有跨设备所有权和 fencing。

`emit_event` 在事务提交、memory index 同步之后调用本机 `_dispatch`，并非事务内持久派发。`submit_command` 在进程内 `_pending_commands` 保存 Future 等待完成；直接换共享数据库不会让另一设备的完成事件自动唤醒它。事件扫描补派发、跨设备结果读取及 SSE/WebSocket 刷新均需单独重构。

### 自动推进

[RuntimeLoop](../backend/app/core/runtime/runtime_loop.py)轮询后台工作和维护任务；[cron registry](../backend/app/core/runtime/cron_registry.py)注册早安简报、截止提醒、记忆衰减、世界模型快照、投影快照、邮件轮询/摘要、URL 监控和 Telegram 轮询。

这让 Runtime 能“自己找事情做”，但每台设备都会独立扫描自己的数据库。将数据库简单换成共享库而不改 claim 语义，会造成重复执行。

### 能力治理

[Capability governance](../backend/app/core/runtime/capability_governance.py)统一处理工具策略、用户审批、taint、外发和审计。能力来自内建工具和 MCP：

- 核心工具：时间、文件、网页、Shell、Git、询问用户；
- 领域工具：日历、邮件、目标、Telegram、剪贴板 OCR、Computer Use、语音；
- 外部 MCP：Playwright、Brave、Context7、GitHub、Tavily、Notion。

这部分适合继续作为目标架构中的效果边界，不需要为云同步再建立第二套工具系统。

## 3. 当前数据与配置

[数据库层](../backend/app/store/database.py)使用 SQLite，[向量层](../backend/app/store/vector.py)使用 Chroma `PersistentClient`。配置中的 `DATA_DIR`、`SQLITE_PATH` 和 `VECTOR_DIR` 都解析为本地路径。

当前共有 19 张表，其中 15 张 governed 表、4 张 app storage 表。详细字段与归类见[当前数据模型](04-data/data-model.md)。

关键限制：

- `event_log.seq` 是本机 SQLite 的自增序号，没有云端全局提交序；
- 事件没有 `command_id` 唯一约束，也没有 aggregate version 乐观并发控制；
- `handler_executions` 只有固定 `instance_id`，没有 `owner_device_id`、lease token、过期时间或 fencing token；
- `timer_events` 没有“某个计划触发时刻全局只创建一次”的唯一键；
- Chroma 是本机派生索引，其他设备无法立即复用；
- `app_settings` 同时承载 UI 偏好、LLM 与邮件配置，未区分可同步配置和设备密钥。

现有 [runtime_config.py](../backend/app/core/runtime/runtime_config.py) 已对保存的邮件密码和 LLM key 使用 Fernet 密文，密钥可由 Windows DPAPI、macOS Keychain 或 Linux libsecret 保护；不能把当前实现概括成明文凭据存储。需要重构的是云端配置与逐设备凭据的归属、稳定引用和授权生命周期，可复用现有 OS 保护实现。

[InstanceLock](../backend/app/store/database.py)通过 `{sqlite_path}.lock` 阻止两个本机后端同时打开同一数据库。这适合保留为“每台设备单实例”保护，但不能承担多设备协调。

## 4. 本地应用连接现状

当前“连接器”更接近内建能力清单：

- 邮件通过通用 IMAP/SMTP 配置运行，只有一组账号配置；
- 日历读写本地 `~/calendar/*.ics`；
- 目标直接使用内部 `work_items`；
- Telegram、Computer Use 和剪贴板依赖当前机器；
- [connectors API](../backend/app/api/connectors.py)对内建邮件/日历返回固定的 available/connected 状态，没有真实的应用发现、账号连接或设备绑定模型。

因此系统还无法表达这些关键事实：同一用户在 Mac 上使用 Apple Mail，在 Windows 上使用 Outlook；某个连接只在指定设备可用；设备离线时任务应该等待其他兼容设备；未安装应用时应给出哪个安装或配置引导。

## 5. 认证与设备身份

当前 API 使用可选的单一 Bearer token。领域 actor 主要是 `system` 或 `user`，没有稳定的账号、设备注册和 Runtime 身份。桌面端默认访问本机后端。

这足以保护一个本机实例，却不能回答：

- 谁拥有共享数据空间；
- 哪台设备正在在线；
- 哪台设备拥有哪些本地应用与权限；
- 哪台设备取得了某次执行权；
- 设备断线后谁可以接管。

## 6. 可以保留与必须改变的边界

可以保留：

- Kernel 单一写入口、事件日志和投影；
- Work 与 `handler_executions` 两类执行语义；
- Scheduler/RuntimeLoop 的职责划分；
- Capability governance、审批、taint、审计和 MCP；
- 产品层已有的简报、收件箱、目标、记忆、交付和返工能力；
- 每台设备只运行一个 Runtime 实例。

必须改变：

- SQLite/Chroma/本地配置组成的权威存储；
- `runtime:primary` 和进程内队列作为执行所有权的假设；
- 定时器“扫描到就执行”的单机语义；
- 邮件/日历等能力与具体应用、账号、设备混在一起的连接方式；
- 单 token、无设备身份的认证方式；
- 全量 snapshot 导入覆盖数据库的恢复方式（不能充当实时同步）；
- “分布式 lease 是非目标”的当前架构约束。

## Architecture contract baseline

下表由 [concept growth guard](../backend/scripts/check_concept_growth.py)校验。它记录当前代码的概念增长上限，不代表目标架构不能在删除旧概念的同时重构。

| 指标 | 上限 | 对应 BASELINE 键 |
|---|---:|---|
| Runtime Python 文件 | 61 | `runtime_files` |
| 事件类型 | 50 | `event_types` |
| query state selector | 17 | `query_state_selectors` |
| Fragment 注册 | 9 | `fragments` |
| Governed 表 | 15 | `governed_tables` |
| Projector 文件 | 6 | `projector_files` |
| God object 最大 LOC | 594 | `god_object_max_loc` |
