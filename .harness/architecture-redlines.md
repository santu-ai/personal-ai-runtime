# 红线与不可侵犯区域

> **改代码前必读。** 完整论证见 `docs/02-concepts/architecture-principles.md`、`docs/02-concepts/kernel-abi.md`、`backend/prompts/coding_rules.md`。此处是浓缩版。

## 1. Protected 路径（agent 不可写）

| 路径 | 原因 |
|---|---|
| `backend/app/core/runtime/kernel/` | Kernel 是冻结 ABI，改动需专门审批流程 |
| `backend/scripts/check_boundary.py` | 边界守卫本身不可被弱化 |
| `backend/capability_policy.json` | 治理策略权威 |
| `backend/app/core/runtime/taint.py` | taint 追踪核心 |
| `.env` / `.env.local` 等 secret 文件 | 密钥 |

例外：`.env.example`、`backend/mcp_config.json` 允许编辑。

## 2. Kernel ABI 冻结

- **新能力默认不得修改 Kernel。** 若必须改，PR 需说明为何不能用 `read_ports` / `harness` / `handlers` / `projectors` 表达。
- 冻结公开方法清单见 `docs/02-concepts/kernel-abi.md`（`emit_event`、`query_state`、`invoke_capability`、`request_approval`、`snapshot/restore/erase` 等）。
- 在 Kernel 包内、非 `projectors_*.py` / 主权重建路径，**禁止**对 GOVERNED 表做 DML（`check_boundary.py` 扫描）。

## 3. 层依赖规则（CI 阻断新增边）

| 规则 | 禁止边 |
|---|---|
| R1 | `core/runtime` → `app.product`（机制不得回调领域策略） |
| R2 | `store` → `app.core.runtime`（存储层不得装配 Runtime） |
| R3 | `api` → Runtime 私有名 / 非 ABI 深模块 |
| R4 | `product` → Runtime 深模块（只允许 `kernel` / Ports ABI / `constants` / `egress`） |

- Product **不得**直访 governed 表或 `event_log`；**不得**绕过 `invoke_capability` 执行外部效果。
- 新边会失败 CI；历史债登记在脚本 `DEBT_ALLOWLIST`，`make layer-deps-inventory` 可查。

## 4. 概念纪律（Concept Compression）

- 核心概念数单调不增：新增模块 / 事件类型 / Fragment / governed 表 / `query_state` selector，**必须在同变更中删除等价旧概念**。
- 真正的复杂度是概念增长，不是文件体积。
- Forbidden 抽象：Framework/Platform/Orchestration 层、Manager/Service/Helper/Utils 上帝模块、第二套 Event/Task/Job 总线、把 Transport 内容写入 `event_log`、Adapter 森林。

## 5. Work Model 统一

- 只有一套 WORK 原语，两个 subtype：领域 Work（`work_items`）与调度 Work（`handler_executions`）。
- 禁止合并为同一张表、禁止发明第三套「任务」模型、禁止用 Lane 之外的平行「Agent 引擎」叙事。

## 6. 事件溯源纪律

- `event_log` append-only（触发器 `event_log_no_update` / `event_log_no_delete`）。
- 投影行必须有对应 `event_log` 事件（`projection-provenance` 守护）。
- 例外（已登记）：`handler_executions` 终端态 soft-prune（ADR-R014，维护特权，`rebuild_all` 仍可重建）。

## 7. 锁文件纪律（改依赖）

改依赖必须三步走，否则 CI / 本地安装直接失败：

```bash
# 1. 同步权威输入：backend/pyproject.toml ↔ backend/requirements.txt（含顺序与 exact pins）
# 2. make dependency-sync
# 3. make lockfile   # pip-tools==7.5.3 生成带哈希与输入 SHA-256 的 requirements.lock
```

## 8. 文档同步纪律

- `docs/` 是活事实库，**改架构/行为必须同步 docs**，否则 `docs-*` CI 失败。
- docs 内叙述用中文、代码标识符/路径/命令保留英文原文。

## 9. Agent 操作红线（来自 `backend/prompts/coding_rules.md`）

- 用相对路径（以项目根为基准），不用 `/README.md` 这类绝对路径。
- 编辑前先读相关文件；小型编辑用 patch，新文件/全量重写才用 write。
- 改完代码建议跑 `make test-backend`。
- 探索用 list_directory / read_file，**不用 shell 列目录**；**不用 shell 读密钥**；避免危险 shell 模式（`find -exec`、无限制 `rm -rf`、把不可信输入接进 shell）。

## 10. 演化原则速记

- Product 持续从 Runtime 分离；Primitive 保持稳定；Runtime 不因功能堆叠增加概念。
- **狗粮证据优先于为洁癖而压缩**——无日用阻碍时，不为「更干净」强行删概念。
