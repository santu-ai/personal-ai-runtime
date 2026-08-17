# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 当前分支：`main`（本轮 Chat 布局修复未推送）
- 进行中任务 / WIP：自主推进
- 已知坏点 / 待办：Memory 2 条 proposed 未 ratify（不代用户确认）；Context live A/B 未测；Chroma 质量未测；审批续写仍 one-shot；日用后端需重启才吃到 max_retries/deny/search/dashboard 过滤
- 最近审阅：2026-08-17 Chat 待确认记忆条与「上下文」按钮错层，不再重合

## 本机环境

### Windows（2026-08-17 本会话）

- 仓库根 `.venv`（PowerShell 5.1）；命令走 `Makefile.ps1`，不用 bash `&&` / heredoc
- 未跟踪过程笔记：`.agent-work/`（非架构 SSOT，未纳入提交）

### macOS Intel x86_64, 13.7.8 — 2026-08-16 主开发接手

- venv：`backend/.venv`（Python 3.12.10）；frontend/desktop 已 `npm ci`
- **cryptography 例外**：PyPI 49.0.0 无 Intel macOS wheel，本机 venv 装的是 **45.0.6**（universal2 wheel，API 兼容，测试全绿）；仓库 lock 仍是 49.0.0。本机勿跑 `make install`（会重装 49.0.0 失败）；若正式降级需走三步锁文件纪律（requirements.txt + pyproject.toml → dependency-sync → lockfile）
- **SENSITIVE_OPS_LOCAL=false** 已写入根目录 `.env`：`_SENSITIVE_PATTERNS` 含 `/Users/` 正则，macOS 本机路径会误触发 high risk（Linux CI 不受影响）；5 个测试（test_taint 1 + eval/benchmarks 4）依赖此设置
- 基线：`make test-backend` 等价 1411 passed / 3 skipped / 4 deselected；boundary / layer-deps / concept-growth 全过
- 根目录 `.env` 已配置真实 DeepSeek key；Gmail 已写入运行时 settings（R2 Inbox 通）

## 产品观察（后续规划候选）

- Wave B 续：Telegram 双向网关
- 可选：proposed 过期自动拒绝（用户未选）
- God Object（`query_builder`/`main`/`mcp_mesh`/`agent_scheduler`）受概念压缩约束，不能无配对拆文件；优先单文件内 helper（见 conventions）。

## 近期改动日志

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-08-17 | Chat 待确认记忆条与上下文按钮分层，避免右上角重合 | 本提交 |
| 2026-08-17 | 仪表盘 recent_memories 走 `recall_memories_for_context` | 已提交 `918a707` 已推送 |
| 2026-08-17 | 公开 `GET /memories/search` 走 claim 过滤召回；抽取去重仍用未过滤 Chroma | 已提交 `b8700a6` 未推送 |
| 2026-08-17 | 首页只计 ratified；Desktop/Vite/CORS 默认 IPv4 回环 | 已提交 `e26849a` 未推送 |
| 2026-08-17 | 审批 deny 持久化 tool result + 会话说明（不调 LLM） | 已提交 `937a97e` 未推送 |
| 2026-08-17 | Chat/Home 内联确认 proposed；ChatRequested max_retries=2；真 LLM Chat+write_file 审批 deny | 已提交 `b539b45` 未推送 |
| 2026-08-17 | W34：email 应用 miss 记 CapabilityFailed；pending→completed 用户捷径；勾选子项重算父进度；soak 找对 SQLITE_PATH；Vite 绑 0.0.0.0 | 已并入 `b539b45` |
| 2026-08-17 | 测试隔离：pin SQLITE_PATH + 重绑 runtime_config.settings；防止 app_settings 写入日用库 | 已推送 `315541f` |
| 2026-08-16 | W33 日用修复：抽取降噪；简报用 pending 邮件计数且不铺 proposed 内容；Chat 待确认横幅；pending→completed 改 400；审批缺 decision 改 422；会话 JSON title；项目根豁免 /Users 敏感误伤 | 本提交 |
| 2026-08-16 | W33-R2 dogfood：Chat/Memory/Work/Desktop/Inbox 全 pass；Memory 需 ratify 后新会话才能召回 | 记录在 `.harness/dogfood/2026-W33.md` |
| 2026-08-16 | 修复 macOS 系统级 symlink（/tmp→/private/tmp）导致 FILESYSTEM_ALLOWED_DIRS 词法校验全拒；显式配置改为追加项目根；symlink 检查改为沿 lexical 根 walk（不先 resolve），堵住 alias 根下 planted symlink 逃逸；+回归测试 | commit `39b9da4` 未推送 |
| 2026-08-13 | 体检 Now 批次：cap_intent 意图+chat 幂等键（E-10/E-11）；url_monitors/inbox 旁路收编+layer-deps R5；单实例文件锁；interrupted 计入 retry 预算；INV-C1/C4/W6 文档校正 | 本提交推送 |
| 2026-08-07 | 记忆 triage：bulk/筛选/count + extractor 减流入（含 distance 去重修复） | commit `59b66c6` |
| 2026-08-06 | Tasks：执行日志 + plan 预览确认；needs_user 建议话术全覆盖 | 前端 |
| 2026-08-06 | harness：TimerFired / APP_STORAGE merge / Monitor SOP | commit `e555558` |
| 2026-08-06 | Inbox Filter Monitor：poll 后求值 + Dashboard 监控 tab | 零新事件/表 |
| 2026-08-06 | Wave A：Tasks/claim review/建议 UX；召回 over-fetch + proposed count 修复 | 准备推送 |
| 2026-08-05 | Alembic 压回唯一 `0001`（对齐 schema_ddl）；删 6 增量；harness §9 + conventions | verify_alembic OK；准备提交 |
| 2026-08-05 | 单文件优化：query_builder safe_*；cancel/denied/timer/lifespan 去重 | commit `6c3dc28` |
| 2026-08-05 | 收口审查遗留：payload upcast；alembic 链守卫；desktop/docs | commit `ac9abb5` |
| 2026-08-05 | P0：删休眠子系统；执行可信/白名单；ADR-R017 | commit `fddafb3` |

## 备注

- dogfood 记录约定（周记格式）仍见 `docs/05-engineering/development.md` §自用检查。
- DLQ 人工重放：`python -m scripts.replay_dead_letters [--limit N] [--dry-run]`
- 开发期 Alembic squash SOP：`.harness/task-recipes.md` §9
