# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 当前分支：`main`（开发阶段）
- 进行中任务 / WIP：无
- 已知坏点 / 待办：无阻塞项；God 拆分仍受 runtime_files 零和约束
- 最近审阅：2026-08-05 未提交改动 review 后修复 conversations 未知 order 兜底 + `_query_by_id` overload；准备提交推送

## 产品观察（后续规划候选）

- God Object（`query_builder`/`main`/`mcp_mesh`/`agent_scheduler`）受概念压缩约束，不能无配对拆文件。
- 单文件优化优先：`query_builder` 助手未用尽（LIMIT 钳制）、`execute_handlers`/`plan_runner`/`agent_scheduler` 取消路径去重。

## 近期改动日志

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-08-05 | 落地单文件优化：query_builder 统一 safe_*；plan/execute/scheduler/governance/timer/chat_stream/main/前端去重 | 1332 passed；**未提交** |
| 2026-08-05 | 未提交改动 review：行为保真核对（顺序/载荷/兜底）+ boundary/layer-deps 守卫 | 无阻塞缺陷；P2 记录 2 项 |
| 2026-08-05 | 单文件内容优化审阅（不跨文件）：Top10 + 按文件明细 | canvas；未提交代码 |
| 2026-08-05 | 收口审查遗留：payload upcast 读路径+CI 链守卫；alembic 线性链/orphan pyc 校验；删 stale `desktop/index.html`；belief/fact 注释+dashboard 查询对齐；memories `order` 经 safe_order 生效；修正「Alembic 失败回退 DDL」文档 | commit `ac9abb5` |
| 2026-08-05 | P0：删 builtin_reactions + core/connectors；死代码清理；原子 take_plan_resume；审批 helper；Scheduler.requeue；connectors/sovereignty 白名单；prompt SSOT；ADR-R017；Makefile.ps1 `$Args`→`-PyArgs` + CI 对齐 | commit `fddafb3` |
| 2026-08-05 | 提炼到 harness：`decision-log` R017（执行可信化 E-1~E-9）、`conventions` 工具索引滞后陷阱、`task-recipes` §8 全量修复闭环复核 SOP、`powershell-tips` §6-7（-Args 卡死 / Get-ChildItem 空输出兜底） | 未提交 |
| 2026-08-05 | 复核收口：删除 `read_ports.get_work_item` 别名（统一 `query_work_item`，12 处 API 调用改齐）；`MemoryRevoked` 幽灵测试改 `MemoryUpdated(confidence=0)` | 148 测试通过；**未提交** |
| 2026-08-05 | 全量修复闭环：死代码/文档/API 契约/概念压缩/`parent_work_id`/执行可信化(E-1…E-9)/数据层/边界守卫；防回归测试+守卫 | alembic `e5f6…dead_letter` + `f6a7…drop_parent_goal`；**未提交** |
| 2026-08-05 | 批次 6：执行可信化 — 步骤幂等/进度、DLQ `dead_letter`、lease TTL、bg timeout→failed、scheduler 非阻塞、approve take-first、TimerFired emit-first | **未提交** |
| 2026-08-05 | 批次 5：删除 `work_items.parent_goal_id`，统一 `parent_work_id`；cascade 递归删子树 | **未提交** |
| 2026-08-05 | 打磨：删 shim / background 旧形 / 加密仅 V2 / `task_queue_length`→`active_work_items`；文档同步 Argon2id；Kernel↛UserSpace fitness 测试 | commit `501c81d` |
| 2026-08-05 | 移除历史兼容层：旧事件桥 / task 别名 / `task_engine`→`work_item_engine` / 域 FSM 去 RETRYING / 前端 Goal shim / 旧快照导入桥 / `/portrait` `/trust` 重定向 | commit `da13e30` |
| 2026-08-04 | 修复 `notify_goal_action_completed` 孤儿 action 的 0/0 噪音通知；新增 `reaction_registry` 行为测试（26 例） | 见 `test_reaction_registry_behavior.py` |
| 2026-08-04 | 新增 `.harness/powershell-tips.md`（`ls -la`/`&&`/heredoc/cwd 等实战坑），`commands.md`/`README.md` 加指针 | 会话实测记录 |
| 2026-08-04 | 创建 `.harness/` agent 工作台；`docs/05-engineering/dogfood-week-1.md` 迁至 `.harness/dogfood/week-1.md`；gitleaks 白名单加 `.harness/.*\.md$` | 结构讨论见会话记录 |
| 2026-08-04 | 测试深化第二轮：`read_ports.memory/work`、`work_item_engine`、`builtin_reactions` 行为测试（74 例）+ 修复 conftest `work_item_engine.kernel` 跨测试泄漏 | 全量 1302 passed，runtime 覆盖率 79% |
| | | |

## 备注

- dogfood 记录约定（周记格式）仍见 `docs/05-engineering/development.md` §自用检查。
- `frontend/REDESIGN_PLAN.md` 已于 2026-08-04 删除（过程痕迹，无需归档）。
- DLQ 人工重放：`python -m scripts.replay_dead_letters [--limit N] [--dry-run]`
