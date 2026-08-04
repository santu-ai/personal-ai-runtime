# 项目地图

## 顶层布局

```
personal-ai-runtime/
├── backend/        # Python 后端（FastAPI + Kernel + 工具），核心子系统
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（lifespan 装配 RuntimeContainer）
│   │   ├── api/                 # HTTP 路由层（Product）
│   │   ├── core/
│   │   │   ├── runtime/         # Runtime 机制（kernel/、handlers/、governance/、read_ports/、egress/）
│   │   │   ├── agents/          # Brain 推理循环（LLM 调用、工具派发）
│   │   │   └── harness/         # MCP 基础设施 + builtin_tools/
│   │   ├── product/             # 领域策略（Product）
│   │   ├── fragments/           # Context Fragment（领域）
│   │   └── store/               # SQLite + Chroma 存储
│   ├── mcp_servers/             # 外部 MCP 服务端（runtime_gateway）
│   ├── prompts/                 # 运行期 prompt（identity.md / coding_rules.md）
│   ├── scripts/                 # CI 与验证脚本
│   ├── tests/                   # pytest
│   ├── alembic/                 # 迁移
│   └── mcp_config.json          # MCP 服务器配置（agent 可编辑）
├── frontend/        # React 19 SPA（Vite + TanStack Query + Zustand + Tailwind v4）
├── desktop/         # Electron 43 包装（spawn 后端、托盘、系统通知）
├── scripts/         # 根级运维脚本（hook 安装、soak、健康等待）
├── docs/            # ⭐ 架构与工程文档唯一权威（SSOT）
├── .githooks/       # pre-commit（ruff+mypy）/ commit-msg（Conventional Commits）
├── .github/         # CI / 发布 / Dependabot
├── Makefile         # Unix 任务编排
├── Makefile.ps1     # Windows PowerShell 等价（子集）
├── install.sh / install.bat / install-hooks.cmd
├── docker-compose.yml
├── .env.example     # 配置模板（agent 可编辑；.env 本体禁止）
└── .gitleaks.toml   # 密钥扫描规则
```

## 三大子系统速查

| 子系统 | 目录 | 技术栈 | 入口 |
|---|---|---|---|
| 后端 | `backend/` | Python 3.12 · FastAPI · SQLite(WAL) · ChromaDB | `app.main:app` |
| 前端 | `frontend/` | React 19 · Vite · TanStack Query · Zustand · Tailwind v4 | `src/main.tsx` |
| 桌面端 | `desktop/` | Electron 43 | `main.js` |

## docs ↔ 代码映射

| 想了解 | 读 |
|---|---|
| 项目是什么 / 整体形态 | `docs/01-overview/project-overview.md` |
| 整体架构与组件关系 | `docs/01-overview/architecture.md` |
| 六原语（Event/State/Capability/Work/Context/Transport） | `docs/02-concepts/runtime-algebra.md` |
| 架构原则 / 层依赖 / Forbidden | `docs/02-concepts/architecture-principles.md` |
| 不变量清单 | `docs/02-concepts/runtime-invariants.md` |
| 执行语义（三车道） | `docs/02-concepts/execution-model.md` |
| Kernel ABI 冻结面 | `docs/02-concepts/kernel-abi.md` |
| 事件溯源数据流 | `docs/02-concepts/event-sourcing.md` |
| 表级边界（GOVERNED vs APP_STORAGE） | `docs/02-concepts/kernel-boundary.md` |
| 3-gate 能力治理 | `docs/02-concepts/capability-governance.md` |
| Context Fragment 管线 | `docs/02-concepts/context-pipeline.md` |
| 子系统实现细节 | `docs/03-subsystems/`（backend-core / backend-api / frontend / desktop / mcp-harness） |
| 数据模型 / 配置 | `docs/04-data/`（data-model / configuration） |
| 工程操作 | `docs/05-engineering/`（development / testing / ci-cd / deployment / security / extending） |
| 全端点表 / Makefile 目标表 | `docs/06-reference/`（api-endpoints / makefile-targets） |
| 架构决策记录 | `docs/07-adr/`（摘要见 [decision-log.md](decision-log.md)） |

## 关键代码位置（常见任务起点）

| 任务 | 位置 |
|---|---|
| 事件 / 投影器 | `backend/app/core/runtime/kernel/`（`emit_event`、`projectors_*.py`） |
| 新增 Capability / 工具 | `backend/app/core/harness/builtin_registration/` + `mcp_config.json` |
| 工具实现 | `backend/app/core/harness/builtin_tools/`（Runtime 基础设施）或 Product 侧 |
| Fragment 注册 | `backend/app/fragments/register.py` |
| 审批 / 治理 | `backend/app/core/runtime/capability_governance.py` |
| 领域 API | `backend/app/api/` |
| LLM 出口审计 | `backend/app/core/runtime/egress/egress_gate.py` |
| MCP 网格 | `backend/app/core/harness/mcp_mesh.py`、`mcp_lifecycle.py` |
