# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 当前分支：`main`（开发阶段）
- 进行中任务 / WIP：无（URL Diff Monitor 已落地）
- 已知坏点 / 待办：无阻塞项；God 拆分仍受 runtime_files 零和约束
- 最近审阅：2026-08-06 URL Diff Monitor（app_settings.url_monitors + 30min cron）

## 产品观察（后续规划候选）

- Wave B 续：Telegram 双向网关；任务面板 previous_output / plan 预览确认
- God Object（`query_builder`/`main`/`mcp_mesh`/`agent_scheduler`）受概念压缩约束，不能无配对拆文件；优先单文件内 helper（见 conventions）。

## 近期改动日志

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-08-06 | URL Diff Monitor：hash 基线 + 变化通知；TimerFired fire-and-forget + save 严格 merge | 修 P1 超时/兄弟列表清空 |
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
