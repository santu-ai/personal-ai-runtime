# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 2026-09-22：Batch 9：`kernel.expire_stale_running_leases` 在本批行都失败后，对终态死信调用与 Scheduler 相同的 `close_dead_lettered_domain_work`。仍有未结束的 sibling 时不收口；剩余重试不重新入队。不新增事件类型。
- 2026-09-22：Batch 8：调度器把本次执行打成终态死信（超时、重试预算耗尽、租约回收、启动时 interrupted 超限）后，立刻用与启动恢复相同的判定把仍为 running 的领域 Work 收成 `failed`（`WorkItemStatusChanged`）。不新开 retry 预算，不新增事件类型。进程死在这两条事件之间时，下次启动仍走原恢复。
- 2026-09-22：Batch 7 文档对齐 #88–#93：任务页写出审批/恢复/模型成本与「重新执行」；`_recover` 预算耗尽走 `ExecutionFailed` 死信。未改守卫脚本。
- 2026-09-22：`CapabilityFailed(error=interrupted_before_audit)` 带上调用当时的 `execution_id` / `caused_by` / `retry_count`。简报恢复次数按同一次中断对齐，不再用 60 秒窗口。没有这些字段的旧事件仍按 correlation 并入已有 handler replay。
- 2026-09-22：任务页改用与目标页相同的 `page-shell`：整页滚动，宽屏列表+详情，窄屏选中后只留详情并可返回列表。交付指标、执行、验收和返工仍在。窄于 md 的侧栏保持图标栏。
- 2026-09-22：Batch 1：执行 handler 已失败时，仍显示 running 的任务会在启动时收成 failed，不再把后台任务重新排队绕过死信；任务页可对死信中的进行中任务重新执行。
- 2026-09-22：前端 UI 刷新 PR #87（`cursor/frontend-ui-refresh-fcd9`）：tokens 表面层次 + 侧栏分组/收起 + PageHeader/SegmentedControl；主页面视觉统一；lint/tsc/vitest/build/e2e 已绿。无后端/Kernel 改动。
- 2026-09-22：前端依赖范围内 patch/minor 已升（react-query 5.103.2、vite 8.3.0、vitest 5.0.1、eslint 10.11.0 等）；跳过 typescript 7（typescript-eslint 仍要 TS 6 API）与 jsdom 30（engines 要求 Node ≥22.22.2，镜像是 node:20）。
- 2026-09-22：`main` 已包含 #80–#86。简报自己的近 30 日首版采纳、返工、已转任务和评审耗时在 `GET /api/work-items/delivery-metrics`，任务页有评审时展示。审批、恢复和模型成本已能按交付 `execution_id` 归因；无 `caused_by` 的历史简报调用仍是 unavailable。全局周期对比、Chat `ask_user`、工具/记忆采纳率仍是另一组指标。
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
