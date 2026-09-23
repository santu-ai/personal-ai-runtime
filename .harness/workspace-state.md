# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 2026-09-23：修复近 24 小时审查发现的三处回归：启动恢复只关联最近一次进入 running 后的 ExecuteRequested，周期统计排除 rerun_restore，重跑清理进度失败会收回 completed。新增三项故障回归测试；后端 1708 passed、lint、boundary、layer-deps、architecture-check 通过。
- 2026-09-23：审查近 24 小时提交（0406412..259f762）：前端 298 测试及构建、后端重点 77 测试、boundary/layer-deps/architecture-check 通过；临时故障用例复现三处缺口：重跑派发中断恢复误用上一轮完成、rerun_restore 被周期统计计作完成、清理计划进度失败后停在 pending。临时用例已移除，未修改业务代码。
- 2026-09-23：Batch 29：再次运行失败收回的 `WorkItemStatusChanged(completed)` 带 `reason=rerun_restore`。依赖钩子只启动 `dependencies_json` 列出这一项且依赖都已完成的待执行后继；收回和没有依赖的待办都不会被标成 `running`。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 28：再次运行已完成简报时，执行请求若在重新打开之后失败，用既有 `WorkItemStatusChanged(completed)` 收回状态，并放回刚才清掉的计划进度。当前交付不变。计划在打开前就不能执行时不改状态。定时到点走同一条路径。不新增事件类型。`read_ports/work.py` 仍为 600/600。
- 2026-09-23：Batch 27：文档对齐 #88–#113 之后仍漂移的陈述。测试文件数为 203；删掉不存在的 `trigger_evaluation` cron，补上 `telegram_poll` 与 `reminder` 的 `work_id` 行为；启动恢复写明 task/action 与终态失败条件；toast 在右下。全局周期对比与简报版本差仍分开写。未改守卫脚本。
- 2026-09-23：Batch 26：已完成且已有交付的项目简报可以「定时再次运行」。既有 `set_timer` 的 payload 写入这一份的 `work_id`。到点若仍可再次运行，就跑同一份任务；否则提醒只打开它。不新建任务，不为这次触发另建交付。`GET /api/dashboard/periods` 仍是全局对比。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 25 CI：真实后端 e2e 同时占住两个临时端口再分别交给假 LLM 和 uvicorn，避免健康检查打到假 LLM 的 GET 501。后端 stdout 会读完，避免管道写满卡住启动。
- 2026-09-23：Batch 25：定时 payload 没有任务 id 时不编造链接。已有非空 `work_id`（没有该键时用 `action_id`）且任务仍在，仪表盘定时行才打开 `/tasks/:id`。已完成且已有交付的项目简报可再次运行：同一任务、不记返工，下一版仍用 `changes_from_previous`。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 24：任务页验收时可以填写可选说明，留空不传 `reason`。已验收版本在交付区显示非空的 `latest_decision.reason`，版本历史同一行也写出；空白不显示。沿用既有 `accept` 与 `latest_decision`，不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 23：任务页交付区列出该版本已存储的 `checks`（通过 / 未通过 / 待判断），非空说明写在同一行。版本历史同一行写出条数；未通过和待判断带上要求。空白检查不显示。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 22：任务页对已有上一版的交付显示「相对 vN」。`changes_from_previous` 在读取时对照 `supersedes_delivery_id`，比较已存储的 findings、sources、limitations、suggested_actions，以及摘要和正文是否变化。不复制上一版全文，不新增事件类型。第一版或上一版缺失时为 null。未改 `read_ports/work.py`。
- 2026-09-23：Batch 21：任务页交付包和 `WorkDelivery` 带上该版本已有的 `latest_decision`（含 `reason`）。「已要求返工」时交付区显示返工理由，版本历史同一行也写出。空白理由不显示。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 20：交付指标对缺少 `caused_by` 的成功 `project_brief` 调用另计 `unattributed_project_brief_cost`，不并入 `llm_cost`；读上限打满时该金额与次数仍是 unavailable。任务页在未归因次数旁写出这笔金额。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 19：交付指标里缺少 `caused_by` 的成功 `project_brief` 调用另计 `unattributed_project_brief_calls`，已归因金额照常加总；读上限打满时金额和次数仍是 unavailable。任务页在金额后标出未归因次数。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 18：任务已失败，或仍为 running 且 handler 已失败/死信时，非空白的 `handler_execution.error` 显示在「重新执行」提示旁；已有交付、日志默认折叠时，显示在交付区上方。日志里的原文仍保留。不改 Kernel，不改 `read_ports`。
- 2026-09-23：Batch 17：计划工具步骤返回 failed/denied 时，把步骤结果里已有的失败原因写入 `ExecuteCompleted.error`。任务详情仍走 Batch 16 的同一条路径。空白原因不写；`continue_on_error` 后计划完成的不写。不新增事件类型。未改 `read_ports/work.py`。
- 2026-09-23：Batch 16：任务详情在调度行 `error` 为空白时，显示同一次 `ExecuteRequested` 引起的 `ExecuteCompleted.error`。`on_execute_requested` 抓住异常后写入异常文本（空白则用异常类型名）再正常返回，不再写成 `handler_failed`。超时/死信仍优先用调度行上的错误。不新增事件类型。`read_ports/work.py` 仍为 598/600。
- 2026-09-23：Batch 15：任务详情 `include=execution` 的 `handler_execution` 带上调度行已有的 `error`（空白为 null），执行日志直接显示。不新增事件类型。
- 2026-09-23：Batch 14：仪表盘「执行」把 `failed` 里除最近一条以外的失败也列出来（最新在前）。与最近失败或死信列表相同的 `id` 不重复；有 `work_id` 时打开 `/tasks/:id`。重试中的错误写在行内。`correlation_id` 不参与去重，也不当作任务 id。不新增事件类型。
- 2026-09-23：Batch 13：仪表盘「执行」的重试行在已有 `work_id` 时打开 `/tasks/:id`。同一条执行（相同 id）已作为最近失败显示时，不再在死信列表里重复；`correlation_id` 不参与去重，也不当作任务 id。不新增事件类型。
- 2026-09-23：Batch 12：仪表盘「执行」的最近失败和死信，在触发事件已有任务 id 且 `work_items` 仍有该行时带上 `work_id`，并打开 `/tasks/:id`。`correlation_id` 不当作任务 id。没有关联的行保持纯文本。不新增事件类型。
- 2026-09-22：Batch 11：任务列表把失败且带 `executable_plan`、且不是简报待办的任务留在「进行中」，行上标「可重新执行」。没有计划的失败、已完成和已取消仍在「历史」。未改执行 API。
- 2026-09-22：Batch 10：任务页在 Work 已是 `failed` 且仍可执行时，主按钮与提示改为「重新执行」；`running` 且 handler 失败/死信的旧窗口保持原提示。执行仍走原来的 `executeWorkItem`。
- 2026-09-22：Batch 9：`kernel.expire_stale_running_leases` 在本批行都失败后，对终态死信调用与 Scheduler 相同的 `close_dead_lettered_domain_work`。仍有未结束的 sibling 时不收口；剩余重试不重新入队。不新增事件类型。
- 2026-09-22：Batch 8：调度器把本次执行打成终态死信（超时、重试预算耗尽、租约回收、启动时 interrupted 超限）后，立刻用与启动恢复相同的判定把仍为 running 的领域 Work 收成 `failed`（`WorkItemStatusChanged`）。不新开 retry 预算，不新增事件类型。进程死在这两条事件之间时，下次启动仍走原恢复。
- 2026-09-22：Batch 7 文档对齐 #88–#93：任务页写出审批/恢复/模型成本与「重新执行」；`_recover` 预算耗尽走 `ExecutionFailed` 死信。未改守卫脚本。
- 2026-09-22：`CapabilityFailed(error=interrupted_before_audit)` 带上调用当时的 `execution_id` / `caused_by` / `retry_count`。简报恢复次数按同一次中断对齐，不再用 60 秒窗口。没有这些字段的旧事件仍按 correlation 并入已有 handler replay。
- 2026-09-22：任务页改用与目标页相同的 `page-shell`：整页滚动，宽屏列表+详情，窄屏选中后只留详情并可返回列表。交付指标、执行、验收和返工仍在。窄于 md 的侧栏保持图标栏。
- 2026-09-22：Batch 1：执行 handler 已失败时，仍显示 running 的任务会在启动时收成 failed，不再把后台任务重新排队绕过死信；任务页可对死信中的进行中任务重新执行。
- 2026-09-22：前端 UI 刷新 PR #87（`cursor/frontend-ui-refresh-fcd9`）：tokens 表面层次 + 侧栏分组/收起 + PageHeader/SegmentedControl；主页面视觉统一；lint/tsc/vitest/build/e2e 已绿。无后端/Kernel 改动。
- 2026-09-22：前端依赖范围内 patch/minor 已升（react-query 5.103.2、vite 8.3.0、vitest 5.0.1、eslint 10.11.0 等）；跳过 typescript 7（typescript-eslint 仍要 TS 6 API）与 jsdom 30（engines 要求 Node ≥22.22.2，镜像是 node:20）。
- 2026-09-22：`main` 已包含 #80–#86。简报自己的近 30 日首版采纳、返工、已转任务和评审耗时在 `GET /api/work-items/delivery-metrics`，任务页有评审时展示。审批、恢复和模型成本已能按交付 `execution_id` 归因；无 `caused_by` 的历史简报调用另计次数，不把已归因金额改成 unavailable。全局周期对比、Chat `ask_user`、工具/记忆采纳率仍是另一组指标。
- 依赖 pin 以 `backend/requirements.txt` / `frontend/package.json` / `desktop/package.json` 为准：`openai==3.16.2`、`mcp==2.2.0`、`pypdf==6.19.0`、`cryptography==50.0.1`；前端 React 19.3 / Vite 8 / lucide-react 1.47；桌面 Electron 44。
- 本机若用系统 `mcp` 1.x，mypy 可能误报；lock 钉 `mcp==2.2.0`，CI 用 lock。
- 仍待用户试用：真 LLM、真实邮箱日用。无 Telegram token 时真实收发仍 blocked。soak 默认空库 `data/personal_ai.db`，日用库不在仓库里。

## 近期合并

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-09-22 | 前端依赖 patch/minor：query 5.103.2、router 7.18.4、vite 8.3.0、vitest 5.0.1、eslint 10.11、prettier 3.9.8；传递依赖 brace-expansion 5.0.12、undici 7.29.1 | 未升 typescript 7 / jsdom 30 |
| 2026-09-22 | 文档与代码对齐：重生参考表无 diff；改过期叙事（Electron/Vite/mcp pin、侧栏、WS 失效、桌面启动顺序、测试文件数） | 未改 CI 守卫 |
| 2026-09-22 | Dependabot #69/#72/#73/#76：pypdf 6.19.0、ruff 0.16.8、openai 3.16.2、lucide-react 1.47.0 | #84，未关 Dependabot PR |
| 2026-09-22 | 周期对比写入早安简报，并走通今日页 Playwright | #83 |
| 2026-09-22 | 近 7 日 vs 前 7 日：完成目标、完成任务、新邮件、采纳率 | #82，无新事件类型 |
| 2026-09-22 | `ask_user`：文本回答回到同一 Chat 工具环；取消写入 denied 并不调 LLM | #81 |
| 2026-09-22 | 采纳率汇总工具建议与记忆确认；治理计数读 ApprovalGranted/Denied | #80 |

## 备注

- 2026-09-23：补上 review 的三处缺口：普通任务 running 但还没有 handler 行时补 `ExecuteRequested`（已结束的 handler 不重跑）；执行快照按触发事件匹配调度行；待评审简报按交付事件查找，不再被最新 100 个普通任务挡住。相关测试 51 passed。

- 2026-09-22：简报交付指标 `GET /api/work-items/delivery-metrics` 与任务页近 30 日摘要已接上。首版采纳 = 窗口内首次评审且接受 v1 的任务 / 窗口内完成首次评审的任务。来源编号在中文标点前不再被截进 id。审批、恢复、模型成本按交付 `execution_id` 关联既有事件。

- 2026-09-22：复核 HEAD `7f5b33b`：相关后端 39 / 前端 57 测试及生产构建通过，boundary/layer-deps/concept-growth/dependency-sync 通过；本机已安装依赖落后于新 lock，未跑完整 merge-gate。原 plan 的建议转 Work 已实现；周期对比目前为全局指标、ask_user 为 Chat 续写、采纳率为工具审批+记忆确认，尚不能等同项目简报周期交付/澄清/首版采纳及成本闭环。真邮箱日用仍待验证；本会话另有两份未提交验证测试，真模型试验超时未定位。

- dogfood 周记格式见 `docs/05-engineering/development.md`。
- DLQ 人工重放：`python -m scripts.replay_dead_letters [--limit N] [--dry-run]`
- 开发期 Alembic squash SOP：`.harness/task-recipes.md` §9
- Windows 提交走 `git -c core.hooksPath=.githooks commit -F`
