# .harness — Coding Agent 工作台

本项目供 **coding agent**（以及想快速上手的人类协作者）读取的高密度作战简报。

## 定位声明

- 本目录是 **agent 工作台 + 过程痕迹库**，**不是**第二套架构文档。
- 架构事实的唯一权威是 [`docs/`](../docs/README.md)，且由 CI（`docs-links` / `docs-table-sync` / `docs-line-refs` / `docs-numbers`）强制与代码同步。
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
| [project-map.md](project-map.md) | 目录地图 + 代码↔文档映射 | 活事实 |
| [commands.md](commands.md) | 常用命令速查 + Windows 注意 | 活事实 |
| [architecture-redlines.md](architecture-redlines.md) | 红线与不可侵犯区域（**改代码前必读**） | 活事实 |
| [decision-log.md](decision-log.md) | ADR 一行式摘要 + Still valid 状态 | 活事实（索引） |
| [conventions.md](conventions.md) | 编码/提交/文档约定 | 活事实 |
| [task-recipes.md](task-recipes.md) | 高频任务 SOP | 活事实 |
| [workspace-state.md](workspace-state.md) | 当前分支 / WIP / 已知坏点 / 近期改动 | **动态，agent 可写** |
| [user-preferences.md](user-preferences.md) | 用户偏好与工作风格 | 动态 |
| [dogfood/](dogfood/) | dogfood 周记等过程记录（从 docs 迁入） | 痕迹，可过期 |

## 维护纪律

- **改动代码前**：先读 `architecture-redlines.md`，再读 `docs/02-concepts/` 相关概念。
- **任务结束后**：顺手在 `workspace-state.md` 更新一行（agent 跨会话恢复上下文的记忆锚点）。
- **不要复制 docs**：需要引用时写指针（相对链接）。
- **不要放密钥**：`.env*`、凭据、API key 一律不进本目录。
