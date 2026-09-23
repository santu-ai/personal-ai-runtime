# Plan：可验收的个人任务助手 MVP

日期：2026-09-17（2026-09-18 更新验证状态）  
状态：P0 已实现并通过 merge-gate 与真实后端端到端回归（见第 12 节）；真 LLM / 真实邮箱日用待用户显式试用。  
适用基线：分析时 HEAD `5136eec`；接手时必须重新核对代码与工作区。  
目标：在现有 Personal AI Runtime 上完成“交办 → 执行 → 有来源的交付 → 验收/返工”闭环。

## 1. 文档用途与接手规则

这是实施计划，放在 `.harness/`，不构成第二套架构权威。当前事实仍以 `docs/` 和代码为准。第 12 节为已冻结实施契约。

接手 agent 必须先读：

1. `AGENTS.md`、`docs/README.md`。
2. `.harness/architecture-redlines.md`、`.harness/project-map.md`。
3. `docs/01-overview/architecture.md`、`docs/02-concepts/runtime-algebra.md`、`docs/02-concepts/kernel-abi.md`。
4. `.harness/user-preferences.md`、`.harness/workspace-state.md`；Windows 执行命令前读 `.harness/powershell-tips.md`。

先检查 `git status`，保留用户已有改动。写代码前读目标文件。不要因本计划而更改已有个人数据、发送真实邮件或修改密钥。Kernel 受保护路径、ABI 或有效 ADR 的改变不因本计划获得授权。

## 2. 产品目标与首个场景

首个场景：用户指定一组项目邮件及资料，系统生成“项目变化、风险、建议待办”简报，附来源，由用户验收或提出修改。

MVP 先支持手动触发的一次性任务。周期运行在一次性闭环稳定后接入已有 timer/monitor；不把首版交付绑定到定时任务、Telegram 或新连接器建设。

示例需求：

> 整理项目 A 最近三天的邮件和我指定的资料，列出变化、风险和建议待办。每条关键结论附来源，资料不足时明确说明。

用户应能完成：

1. 从任务页创建任务，确认资料范围、时间范围和验收要求。
2. 启动执行；必要时通过已有审批流程授权具体操作。
3. 打开任务，首先看到交付结果和未完成项，再按需查看执行日志。
4. 查看来源，接受某一版交付，或填写修改意见发起返工。
5. 刷新或重启后仍能看到交付版本、验收决定及当前执行状态。

审批回答“是否允许执行操作”；验收回答“这一版结果是否满足要求”。两者必须分开。

## 3. 范围

### P0：本计划必须交付

- 一种内置任务模板：项目资料简报。
- 创建入口与结构化任务要求；MVP 用表单补齐必要信息。
- 接入现有已配置邮箱/资料读取能力；未配置来源明确提示，不伪造结果。
- 结构化交付、来源引用、完整内容展示。
- 按交付版本验收、带理由返工、历史版本浏览。
- 重启恢复、重复提交防护、失败/部分结果呈现。
- 行为测试、真实后端端到端验证，以及可执行的日用验收步骤。

### P1：P0 验收后再做

- 接入现有 timer/monitor，区分每次运行与交付，展示相对上一期的变化。
- 用户选择后将建议待办转为现有 Work；创建请求必须去重。
- 基于真实阻塞需求扩展持久化澄清交互；不提前建设通用 `ask_user` 引擎。
- 汇总采纳率、介入次数、耗时与成本。

### 明确不做

- 多租户、团队权限、插件市场、多 Agent 编排框架、新的任务/调度总线。
- 自动发送邮件、对外发布、无用户确认地修改真实业务数据。
- 自动把验收意见写成已确认长期记忆；继续遵循既有记忆治理。
- 通用文档编辑器、文件版本平台、任意输出格式生成器。

## 4. 当前代码依据与限制

| 位置 | 已观察到的基础 | 实施含义 |
|---|---|---|
| `frontend/src/pages/Tasks.tsx` | 计划、进度、步骤输出、执行事件；输出展示会截短 | 增加结果优先的详情布局，保留调试入口 |
| `backend/app/api/work_items.py` | 创建/更新 Work；既有状态集合 | 不直接新增全局 `accepted` 状态 |
| `backend/app/core/runtime/read_ports/work.py` | Work 查询和变更入口 | API/Product 经允许端口访问 |
| `backend/app/core/runtime/work_item_engine.py` | 状态转换与 Work 生命周期 | 返工必须走受支持转换或创建关联 Work |
| `backend/app/core/runtime/handlers/plan_runner.py` | 工具步骤、审批挂起、幂等记录；步骤输出上限 1000 字符 | 步骤预览不能作为完整交付存储 |
| `backend/app/core/agents/context_compaction.py` | MessageAppended checkpoint | 长任务上下文需保留要求与返工意见 |
| `backend/app/core/agents/tool_spill.py` | 大工具结果外溢，保留定位信息 | spill 是执行机制，不自动等于交付物存储契约 |
| `backend/app/product/personal_dashboard.py` | 今日工作台与执行信任汇总 | 可呈现待验收入口，避免多处重复计数 |
| `backend/tests/recorded_sessions/` | 脚本模型 + 真 Brain/Kernel 行为回放 | 复用测试思路，核对结果及副作用 |
| `.harness/dogfood/2026-W35.md`、`2026-W36.md` | 部分真实日用验证及明确未测项 | 不把历史 pass 当作本次验收 |

本计划未运行应用或全量测试；接手者必须建立自己的验证基线。

## 5. 架构约束与必须先完成的设计验证（T0）

保持单一 Work 模型，复用 Event/State/Capability/Work/Context/Transport。Product 不直写 GOVERNED 表，不直读 event_log，不绕过 Kernel 调用工具。不要为了满足数量限制，把新业务事实伪装成无关事件。

**T0 必须解决持久化问题后，才能并行开发前后端。** 当前 Work 表没有专用交付/验收字段，本计划不假设任意 payload 会被 projector 保留。

T0 输出：在本计划末尾补充“已冻结实施契约”，列出实际事件及 payload、读写 ABI、版本关联、幂等/并发机制、API JSON 示例和对应测试。

验证顺序：

1. 检查现有 Work、Conversation/Message 及事件读端口能否语义正确地承载要求、交付版本和用户决定。
2. 用隔离测试库演示：创建任务 → 发布 v1 → 请求返工 → 发布 v2 → 接受 v2 → 重启/重建 → 读出相同业务事实。
3. 检查重复请求和过期版本验收；明确事件持久化与执行派发之间中断的恢复办法。
4. 验证完整正文和引用在导出/导入后可用；若使用文件，必须纳入文件生命周期及恢复设计。
5. 若只能通过新增核心概念、修改受保护 Kernel/投影器或改变 ABI 实现，提交最小变更说明，说明现有组合为何不足，并按仓库规则取得专项授权；不得绕过到 APP_STORAGE、app_settings 或裸 JSON 文件充当业务真相。

T0 可以在不改受保护文件的范围内自行选择实现；遇到上述边界才停在具体设计处，不要求用户反复确认普通实现细节。

## 6. 建议业务契约（逻辑结构，不是数据库 DDL）

### 6.1 任务要求

- `work_id`：复用现有 Work ID。
- `contract_version`：要求版本；执行时锁定使用的版本。
- `objective`：目标。
- `source_scope`：明确来源标识、时间范围、时区和数量限制。
- `acceptance_criteria`：可检查的要求，如“每条关键结论有引用”。
- `output_kind`：首版固定为项目简报。

不得用覆盖用户 description 的方式偷偷保存内部协议；保留原始需求可读性。执行中的要求变更必须建立新版本，不能改变既有交付的解释。

### 6.2 交付版本

- `delivery_id`、`work_id`、`version`、`contract_version`、`execution_id`、`created_at`。
- `summary`、完整 `content`、`limitations`、建议待办。
- `sources`：稳定来源 ID、类型、标题、定位信息、获取时间；有条件时记录内容版本/哈希。
- `checks`：逐条验收要求的检查结果；区分可程序验证和需要人工判断的项目。
- `supersedes_delivery_id`：返工后关联前一版。
- `schema_version`：为结构兼容保留版本。

模型输出需要结构校验；引用必须来自本次允许读取的来源集合。资料缺失时明确标为不足，不能凭模型猜测补造引用。来源后来不可访问时显示原因，不以新内容静默替换旧依据。

交付版本发布后不可覆盖。完整结果不能仅来自 `previous_output` 或 UI 截断预览，也不能只存在内存或前端缓存中。

### 6.3 验收与返工

- 每个决定绑定 `delivery_id` 和版本，记录用户身份、时间、决定、理由及请求幂等键。
- 产品验收状态：`unreviewed` / `accepted` / `changes_requested`；这是交付业务状态，不替换现有 Work 执行状态。
- `completed` 只代表执行完成，不自动表示交付已验收。
- 返工必须带非空理由，并保留旧版；新执行使用原要求及修改意见。
- 对旧版的接受请求返回冲突并提示刷新；不得误接受当前新版。
- 同一请求重复发送返回同一结果；并发的冲突决定只能有一个生效。
- 返工创建新执行归属；同一次执行的重试保留幂等语义，不能重放已完成外部副作用。
- 用户接受结果不能跳过工具审批，也不能隐式触发发送/发布。

### 6.4 API 表面

沿用 Work 路由组织，建议能力为：创建模板任务、读取交付列表/详情、接受指定版本、请求返工。具体 URL 和 DTO 在 T0 冻结，之后前后端共享契约。

必须定义：未找到、校验失败、版本冲突、重复请求、来源未配置、执行失败的返回方式；遵循当前项目认证和错误格式。旧任务没有交付时仍能正常查看和执行。

## 7. 开发工作包与依赖

| ID | 工作包 | 依赖 | 交付与完成条件 |
|---|---|---|---|
| T0 | 持久化/恢复最小验证与契约冻结 | 无 | 第 5 节验证通过；记录真实接口和边界决定 |
| T1 | 后端交付、验收、返工服务/API | T0 | 完整读取、版本化决定、幂等与冲突处理；隔离集成测试通过 |
| T2 | 项目简报任务执行 | T0；集成依赖 T1 | 使用现有来源能力及执行车道，生成完整交付并校验引用；失败不冒充成功 |
| T3 | 任务创建与结果优先 UI | T0；最终联调依赖 T1/T2 | 创建、执行、阅读来源、验收、返工、版本历史、错误及空态 |
| T4 | 真实后端闭环与恢复回归 | T1/T2/T3 | 按第 8 节验证，不只 mock API |
| T5 | 文档、日用试验与发布收口 | T4 | 更新 docs；提供真实试用记录和限制；完成合并门禁 |

用户可将 T1、T2、T3 分配给不同 agent；T0 完成前不要让它们各自发明字段或存储模型。测试 agent 可在契约冻结后先准备夹具及失败场景。

共享文件指定单一负责人：Work API/读端口由后端负责人维护；前端 client 类型由 UI 负责人维护；Makefile、依赖锁、架构 docs 的修改由集成人汇总。其他 agent 提出接口需求，不并发修改同一文件。优先独立分支/worktree，小批次集成。

## 8. 验收矩阵

| 编号 | 场景 | 必须断言 |
|---|---|---|
| A1 | 固定邮件和资料输入 → 首版简报 | 有完整正文、来源、要求版本；关键结论引用来自输入集合 |
| A2 | 接受 v1 后刷新及重启 | 仍显示 v1 已接受；没有重复执行或新交付 |
| A3 | v1 返工 → v2 → 接受 | 原意见可查、旧版保留；接受只关联 v2 |
| A4 | 双击/重发验收与返工 | 一个有效决定，一次返工派发；并发冲突明确 |
| A5 | v2 发布后接受旧 v1 | 冲突，不误改 v2 或 Work 状态 |
| A6 | 数据源为空、未配置或读取失败 | 区分真实无变化和失败；不生成虚假完整简报 |
| A7 | 模型输出非法结构/伪造来源 | 拒绝发布为合格交付或明确失败；提供可重试信息 |
| A8 | 工具成功后进程退出/LLM 失败 | 恢复不重复副作用；业务状态不永久停在错误中间态 |
| A9 | 交付正文超过步骤输出上限 | 完整可读，来源仍有效；不能只有 1000/240 字预览 |
| A10 | 重建与导出/导入 | 要求、全部交付版本、验收关联不丢失；文件引用若存在须可恢复 |
| A11 | 旧任务、旧会话与既有审批 | 无交付时兼容；原执行/连续审批测试仍通过 |
| A12 | 不可信资料包含工具指令 | 不越过来源范围或已有治理；不得诱发未授权写入 |

自动化分层：

- 后端集成：真 Kernel + 临时数据库；重点验证业务事实与状态转换。
- 执行回放：固定模型响应，真实工具环，断言交付、来源及副作用次数。
- 前端：用户操作、冲突/错误反馈和跨版本展示。
- 端到端：真实后端 + fake LLM 跑创建至验收/返工，并至少包含一次重启。
- 真 LLM 日用：有环境条件时显式运行；记录供应商/模型、时间、结果及人工修正。缺凭据记 blocked，不能用 mock 代替真实验收。

外部效果跨进程中断的保证必须以实际工具支持为准。无法安全自动重试的结果标记为需人工核对，不宣称全系统 exactly-once。

## 9. 质量门禁与文档同步

以仓库当前 AGENTS 和 Makefile 为准。Windows 使用 `Makefile.ps1 -Task <任务>`；缺少对应 PowerShell 任务时查 Makefile 使用项目 `.venv` 执行等价脚本，不能假设全部目标都支持。

- 任意后端修改：`test-backend` + `lint`。
- 层依赖/导入修改：`layer-deps`。
- Kernel/投影/表修改（仅获授权后）：`boundary` + `projection-provenance` + `rebuild-verify`。
- Runtime/事件等概念面：`architecture-check`；不静默抬高红线。
- API 路由等变更：`docs-gen`，随后检查生成物。
- 前端变更：前端测试、类型检查、构建及对应端到端测试。
- 文档链接：`docs-links` 对应检查。
- 集成完成：`merge-gate`；本地限制导致未跑项必须逐项说明。

更新 `docs/` 中受影响的行为说明和自动生成参考；不要把“计划新增”写成“已经支持”。任务结束写回 `.harness/workspace-state.md`。Conventional Commits；不推送远程，除非获得用户授权。

## 10. 日用试验与是否继续扩展

连续两周在一个真实项目使用，先手动触发。记录以下数据；这是目标测量方式，不是已达到的指标：

- 每周实际验收的任务数，以 work_id 去重。
- 首版采纳率：首次交付即接受的任务数 / 已完成首次评审的任务数。
- 每项任务的返工次数及人工介入次数；审批、修正、恢复分别计数。
- 用户自报人工耗时与使用后耗时，给出节省时间估计。
- 虚假引用、重复副作用、状态丢失次数，以及任务成本（当前可测范围内）。

建议试验门槛：至少 10 个真实任务完成评审，第二周仍主动使用；无未解决的重复副作用/丢失验收记录问题。样本不足时延长试验，不用单次成功判断产品成立。

P1 的启动依据是重复使用和真实阻塞。若用户仍需大量重写简报，优先改善来源选择、任务要求和结果质量，暂停扩展通道及框架。

## 11. 可复制给开发 agent 的任务说明

> 请按 `.harness/plan-task-delivery-mvp.md` 开发“可验收的个人任务助手”MVP。先读取 AGENTS 指定文档并核对当前工作区，从 T0 开始冻结持久化、API 和恢复契约，再推进工作包。遵守 Kernel 保护和单一 Work 模型；不把业务事实旁路写入 APP_STORAGE，不用步骤预览充当完整交付。完成创建、执行、有来源的结果、版本验收和返工闭环，覆盖失败、重复请求、重启及重建。按改动运行必要测试并更新 docs。最终报告完成的工作包、验证证据、未完成项和限制。不要修改真实个人数据或发送邮件，不推送远程。

## 12. 已冻结实施契约与交接记录

基线 commit：`5136eec`。未改 Kernel ABI、未新增事件类型/投影表/governed 列。

### 持久化与读写 ABI

- **任务要求**：`executable_plan` JSON 的 `kind=project_brief` + `contract`（`contract_version` / `objective` / `source_scope` / `acceptance_criteria` / `output_kind`）。用户可见原文在 `description`，不被内部协议覆盖。
- **交付版本**：`WorkItemUpdated` payload 键 `delivery_published`。投影器忽略该键，`event_log` 为权威；Product `fold_delivery_history` 重建版本链。
- **验收/返工**：同事件类型 payload 键 `delivery_decision`（`accepted` | `changes_requested`）。产品验收状态独立于 Work 执行状态；`completed` 不等于已验收。
- **读路径**：`kernel.read_events(aggregate_type=work_item, aggregate_id=…)` → `app.product.work_delivery`。
- **写路径**：`kernel.emit_event(WorkItemUpdated, work_item, work_id, payload=…)`。User Space 不直写 GOVERNED 表。

### 幂等、并发、恢复

- 同一 `execution_id` 重复发布返回已有交付（执行重试不双写）。
- 验收/返工带 `idempotency_key`；重复请求返回 `replayed=true`。
- 对非当前版本的验收/返工返回 409 `stale_delivery`。
- 进程内按 `work_id` 加锁；SQLite 单写保证事件顺序。
- 返工：记录决定 → 写入 `rework_notes` → `completed|failed` 转到 `pending` → 清 plan progress → `ExecuteRequested`。
- 崩溃后重建：`rebuild_all` 后折叠事件即可得到同一交付与验收事实。正文在事件 payload，不依赖 spill/步骤预览。

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/work-items/project-brief` | 创建模板任务 |
| GET | `/api/work-items/unreviewed-deliveries` | 待验收列表 |
| GET | `/api/work-items/{id}?include=deliveries` | 详情附 `delivery_bundle` |
| GET | `/api/work-items/{id}/deliveries` | 版本列表 + 当前版全文 |
| GET | `/api/work-items/{id}/deliveries/{delivery_id}` | 指定版本全文 |
| POST | `/api/work-items/{id}/deliveries/{delivery_id}/accept` | 验收（理由可选，空白存空字符串） |
| POST | `/api/work-items/{id}/deliveries/{delivery_id}/rework` | 返工（理由必填） |
| POST | `/api/work-items/{id}/deliveries/{delivery_id}/actions/{index}/adopt` | 将当前版本的一条建议待办转为子任务；重复请求返回同一任务 |

错误：404 未找到；400 校验失败（含空返工理由）；409 版本冲突。旧任务无交付时列表 `current=null`，执行行为不变。交付列表、详情 `delivery_bundle` 和单版本读取的每个版本都带 `latest_decision`（与 `get_delivery` 相同的决定，含 `reason`）。没有决定时为 null。任务页在「已验收」和「已要求返工」下显示非空理由；空白理由不显示。验收说明可选。同一读取还带 `changes_from_previous`：有 `supersedes_delivery_id` 且上一版仍在事件里时，现算 findings、sources、limitations、suggested_actions 的增删改，以及摘要、正文是否变化；不复制全文，不新增事件。第一版或上一版缺失时为 null。任务页在交付区显示「相对 vN」。同一读取里的 `checks` 也显示在交付区：`pass` / `fail` / `needs_review` 分别是通过、未通过、待判断；版本历史同一行写出条数，未通过和待判断带上要求。空白检查不显示。

### 执行

`ExecuteRequested` 跑现有 `check_inbox` / `read_file` 步骤（`continue_on_error`）。成功后经 RuntimeContainer 绑定的 Product 编译器合成简报、校验引用并发布完整交付。不新增 Capability，不改 `capability_policy.json`。来源失败不生成虚假合格简报；伪造引用拒绝发布。

### 受保护路径

未修改 `kernel/` 实现、`check_boundary.py`、`capability_policy.json`、`taint.py`、密钥文件。`runtime_container` / `kernel_instance` 仅增加与 inbox poll 同构的 Product 绑定。

### 验证（2026-09-18 最新）

- `Makefile.ps1 -Task merge-gate` 通过：后端 1593 passed / 9 skipped / 5 deselected；前端 240 passed（46 文件）+ `tsc -b && vite build`；boundary / layer-deps / projection-provenance / rebuild-verify 全过。
- 真实后端端到端：`backend/tests/integration/test_project_brief_delivery_e2e.py`，API TestClient 背后的真 Kernel + 临时 SQLite + 真 `ExecuteRequested` handler，只 stub 收件箱能力与 LLM。
- 真 LLM + 真实邮箱日用未在本会话执行（会读取真实邮件，留待用户显式试用）。

### 验收矩阵覆盖

| 编号 | 覆盖位置 |
|---|---|
| A1 / A9 | `test_brief_accept_rework_and_restart_keep_delivery_facts`（首版有来源；正文 > 1000 字符） |
| A2 / A10 | 同上：验收后 `rebuild_all` 仍是同一版本/正文/验收状态，不重复派发 |
| A3 | 同上：返工 → v2 → 接受 v2，旧版与返工意见保留 |
| A4 | 同上：重复验收/返工只产生一个决定、一次派发 |
| A5 | 同上 + `test_accept_rework_conflict_and_idempotency`（旧版验收 409） |
| A6 | `test_compile_source_failure_is_unqualified`（来源失败不冒充合格） |
| A7 | `test_compile_rejects_forged_model_output` + E2E A12 用例 |
| A8 | `test_brief_retry_after_model_failure_reuses_read_sources`、`test_brief_resumes_after_exit_between_tool_and_publish`、`test_approve_recovers_after_take_before_dispatch_exit` |
| A11 | `test_old_task_without_delivery_endpoints`、`test_old_work_without_delivery_still_reads` |
| A12 | `test_brief_source_with_tool_instructions_stays_in_scope`（注入内容只作不可信数据，不产生额外工具调用） |

### 工作包

| ID | 状态 |
|---|---|
| T0 | 完成 |
| T1 | 完成 |
| T2 | 完成 |
| T3 | 完成 |
| T4 | 完成：真实后端 create → execute → 交付 → 验收/返工 → 重启回归，含中断恢复 |
| T5 | 完成：docs 已同步；merge-gate 整包通过。真 LLM / 真实邮箱日用仍待用户显式试用（第 10 节） |

P1：建议待办可转为现有 Work，同一交付下标重复请求返回同一任务。简报自己的首版采纳、返工、已转任务和评审耗时见 `GET /api/work-items/delivery-metrics`。审批次数与崩溃恢复按交付 `execution_id` 关联既有 `CapabilityDenied` / 高风险 `ApprovalRequested` / `ExecutionRetried` / `CapabilityFailed`；模型成本汇总 `caused_by` 指向该执行的 `LLMCallRecorded`。同一次中断只计一次：`ExecutionRetried(reason=interrupted, status=retrying)` 或 `ExecutionFailed(error=interrupted)` 与带同一执行、同一 `retry_count` 的 `CapabilityFailed(error=interrupted_before_audit)` 不重复计数；没有这些字段的旧事件仍按 correlation 并入已有 handler replay。读上限打满时审批、恢复、模型成本、未归因简报调用次数和未归因金额都是 unavailable。全局周期对比（`GET /api/dashboard/periods`）、Chat 澄清（`ask_user`，ADR-R011）和工具/记忆采纳率（`GET /api/telemetry/governance`）是另一组指标。缺少 `caused_by` 的历史 `project_brief` 调用计入 `unattributed_project_brief_calls`，其金额合计为 `unattributed_project_brief_cost`，不并入已归因金额，也不把已归因金额改成 unavailable。任务页在「已验收」和「已要求返工」时显示该版本非空的 `latest_decision.reason`。验收说明可选，留空不显示。同一任务的相邻交付已能在任务页看到「相对上一版」（`changes_from_previous`，读取时现算，不新增事件）。任务页交付区列出该版本已存储的验收检查（`pass` / `fail` / `needs_review`），版本历史同一行写出计数。周期运行仍未接入：现有 timer/monitor 还没有把每次运行和交付分开，也没有相对上一期交付的变化；`GET /api/dashboard/periods` 仍是全局对比。
