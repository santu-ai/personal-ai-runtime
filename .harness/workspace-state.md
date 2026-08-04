# Workspace State（动态区）

> **agent 可写、可过期。** 任务结束后顺手更新一行，作为跨会话恢复上下文的记忆锚点。
> 若与代码现状冲突，以代码 / docs 为准，并修正本文件。

## 当前状态

- 当前分支：`（填写）`
- 进行中任务 / WIP：`（填写）`
- 已知坏点 / 待办：`（填写）`

## 产品观察（后续规划候选）

- `delete_work_item(cascade=True)` 不递归删除孙级，会留下 `parent_work_id` 指向已删 action 的孤儿子步骤——已由 `test_delete_work_item_cascade_removes_direct_children` 锁定现状。
- ~~`notify_goal_action_completed` 对不存在 action 产生 "0/0 步已完成" 通知~~ → 已修复（2026-08-04）：无子项时跳过通知、保留 memory 副作用。

## 近期改动日志

| 日期 | 改动摘要 | 备注 |
|---|---|---|
| 2026-08-04 | 修复 `notify_goal_action_completed` 孤儿 action 的 0/0 噪音通知；新增 `reaction_registry` 行为测试（26 例） | 见 `test_reaction_registry_behavior.py` |
| 2026-08-04 | 新增 `.harness/powershell-tips.md`（`ls -la`/`&&`/heredoc/cwd 等实战坑），`commands.md`/`README.md` 加指针 | 会话实测记录 |
| 2026-08-04 | 创建 `.harness/` agent 工作台；`docs/05-engineering/dogfood-week-1.md` 迁至 `.harness/dogfood/week-1.md`；gitleaks 白名单加 `.harness/.*\.md$` | 结构讨论见会话记录 |
| 2026-08-04 | 测试深化第二轮：`read_ports.memory/work`、`task_engine`、`builtin_reactions` 行为测试（74 例）+ 修复 conftest `task_engine.kernel` 跨测试泄漏 | 全量 1302 passed，runtime 覆盖率 79% |
| | | |

## 备注

- dogfood 记录约定（周记格式）仍见 `docs/05-engineering/development.md` §自用检查。
- `frontend/REDESIGN_PLAN.md` 已于 2026-08-04 删除（过程痕迹，无需归档）。
