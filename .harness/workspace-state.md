# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 2026-09-22：`main` 已包含 #80–#84。建议采纳（今日页 + 信任页，`GET /api/telemetry/governance`）、`ask_user` 澄清续写（ADR-R011，不计入采纳率）、周期对比（`GET /api/dashboard/periods`，今日页 + 早安简报正文）都已落地。无新事件类型。
- 依赖 pin 以 `backend/requirements.txt` / `frontend/package.json` / `desktop/package.json` 为准：`openai==3.16.2`、`mcp==2.2.0`、`pypdf==6.19.0`、`cryptography==50.0.1`；前端 React 19.3 / Vite 8 / lucide-react 1.47；桌面 Electron 44。
- 本机若用系统 `mcp` 1.x，mypy 可能误报；lock 钉 `mcp==2.2.0`，CI 用 lock。
- 仍待用户试用：真 LLM、真实邮箱日用。无 Telegram token 时真实收发仍 blocked。soak 默认空库 `data/personal_ai.db`，日用库不在仓库里。

## 近期合并

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-09-22 | 文档与代码对齐：重生参考表无 diff；改过期叙事（Electron/Vite/mcp pin、侧栏、WS 失效、桌面启动顺序、测试文件数） | 未改 CI 守卫 |
| 2026-09-22 | Dependabot #69/#72/#73/#76：pypdf 6.19.0、ruff 0.16.8、openai 3.16.2、lucide-react 1.47.0 | #84，未关 Dependabot PR |
| 2026-09-22 | 周期对比写入早安简报，并走通今日页 Playwright | #83 |
| 2026-09-22 | 近 7 日 vs 前 7 日：完成目标、完成任务、新邮件、采纳率 | #82，无新事件类型 |
| 2026-09-22 | `ask_user`：文本回答回到同一 Chat 工具环；取消写入 denied 并不调 LLM | #81 |
| 2026-09-22 | 采纳率汇总工具建议与记忆确认；治理计数读 ApprovalGranted/Denied | #80 |

## 备注

- dogfood 周记格式见 `docs/05-engineering/development.md`。
- DLQ 人工重放：`python -m scripts.replay_dead_letters [--limit N] [--dry-run]`
- 开发期 Alembic squash SOP：`.harness/task-recipes.md` §9
- Windows 提交走 `git -c core.hooksPath=.githooks commit -F`
