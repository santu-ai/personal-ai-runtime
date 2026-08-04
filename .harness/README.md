# .harness — Coding Agent 工作台

本项目供 **coding agent**（以及想快速上手的人类协作者）读取的高密度作战简报。

**首选入口**：仓库根目录 [`AGENTS.md`](../AGENTS.md)。

## 定位声明

- 本目录是 **agent 工作台 + 过程痕迹库**，**不是**第二套架构文档。
- 架构事实的唯一权威是 [`docs/`](../docs/README.md)，且由 CI（`docs-links` / `docs-table-sync` / `docs-line-refs` / `docs-numbers` / `docs-gen-check`）强制与代码同步。
- 凡"描述当前代码事实"的内容应指向 `docs/` 而非在本目录重写；本目录内容允许过期、允许主观、允许被 agent 写入。

## 判读规则

| 内容类型 | 存放位置 |
|---|---|
| 活事实（代码变了它就错） | `docs/`（SSOT） |
| 过程痕迹（周记、计划、待定状态、主观结论） | `.harness/`（可过期） |

判别问题：**"这句话过期后，系统会变错吗？"** 会 → `docs/`；不会 → `.harness/`。

## 目录导航

| 文件 | 内容 | 性质 |
|---|---|---|
| [project-map.md](project-map.md) | 任务→代码快捷定位 | 指针 + 增量 |
| [powershell-tips.md](powershell-tips.md) | Windows PowerShell 实战陷阱 | **高价值增量** |
| [architecture-redlines.md](architecture-redlines.md) | 红线速查（**改代码前必读**） | 浓缩（权威在 docs） |
| [decision-log.md](decision-log.md) | ADR 一行式摘要 | **高价值索引** |
| [conventions.md](conventions.md) | 提交/检查最短清单 | 指针 |
| [task-recipes.md](task-recipes.md) | 高频任务 SOP 清单 | 指针 |
| [workspace-state.md](workspace-state.md) | 当前分支 / WIP / 已知坏点 | **动态，agent 可写** |
| [user-preferences.md](user-preferences.md) | 用户偏好与工作风格 | 动态 |
| [dogfood/](dogfood/) | dogfood 周记 | 痕迹，可过期 |

命令全表已迁至自动生成的 [`docs/06-reference/makefile-targets.md`](../docs/06-reference/makefile-targets.md)（原 `commands.md` 已删除）。

## 维护纪律

- **改动代码前**：先读 `architecture-redlines.md`，再读 `docs/02-concepts/` 相关概念。
- **任务结束后**：顺手在 `workspace-state.md` 更新一行。
- **不要复制 docs**：需要引用时写指针（相对链接）。
- **不要放密钥**：`.env*`、凭据、API key 一律不进本目录。
