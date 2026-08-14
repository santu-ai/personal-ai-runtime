# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 当前分支：`main`（开发阶段）
- 进行中任务 / WIP：无
- 已知坏点 / 待办：体检 Next 批次候选——verify_alembic 默认值 parity、webhook/ntfy SSRF-safe、untrusted prompt 定界、Scheduler.stop 排干、boundary 多行 SQL 扫描、§5 删除项 1-6
- 最近审阅：2026-08-13 体检 Now 批次整改（P0 双写窗口 + P1×4）全绿收口

## 产品观察（后续规划候选）

- Wave B 续：Telegram 双向网关
- 可选：proposed 过期自动拒绝（用户未选）
- God Object（`query_builder`/`main`/`mcp_mesh`/`agent_scheduler`）受概念压缩约束，不能无配对拆文件；优先单文件内 helper（见 conventions）。

## 近期改动日志

| 日期 | 改动摘要 | 备注 |
|---|---|---|
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
