# AGENTS.md — Coding Agent 入口（自动引导）

本文件是 Coding Agent 进入本仓库时的**首选阅读入口**。架构事实以 [`docs/`](docs/README.md) 为准；本文件只提供最短上手路径。

## 必读顺序（冷启动）

1. [`docs/README.md`](docs/README.md) — 文档地图与阅读路径
2. [`.harness/architecture-redlines.md`](.harness/architecture-redlines.md) — 改代码前的红线（**必读**）
3. [`.harness/project-map.md`](.harness/project-map.md) — 目录地图与任务→代码定位

架构权威：[`docs/01-overview/architecture.md`](docs/01-overview/architecture.md)、[`docs/02-concepts/runtime-algebra.md`](docs/02-concepts/runtime-algebra.md)。

## 三个高价值 harness 文件（docs 没有的增量）

| 文件 | 何时读 |
|---|---|
| [`.harness/powershell-tips.md`](.harness/powershell-tips.md) | Windows / PowerShell 下执行任何 shell 命令前 |
| [`.harness/decision-log.md`](.harness/decision-log.md) | 需要快速确认 ADR 状态时（完整 ADR 在 `docs/07-adr/`） |
| [`.harness/workspace-state.md`](.harness/workspace-state.md) | 跨会话恢复；任务结束后**写回一行** |

其余 `.harness/` 内容多为 `docs/` 的指针或浓缩，不要当第二套 SSOT。

## 入口与边界

| 关心点 | 位置 |
|---|---|
| FastAPI 入口 | `backend/app/main.py` → `app` |
| Kernel ABI（唯一写入口） | `backend/app/core/runtime/kernel/kernel.py` → `emit_event` |
| 读端口 | `backend/app/core/runtime/read_ports/` |
| 能力治理 | `backend/app/core/runtime/capability_governance.py` |
| MCP / 工具 | `backend/app/core/harness/` + `backend/mcp_config.json` |
| 前端入口 | `frontend/src/main.tsx` |
| 桌面入口 | `desktop/main.js` |

**边界铁律**：User Space（`api/` / `product/` / `fragments/` / `agents/`）不得直写 GOVERNED 表，不得绕过 Kernel 调 `mcp_hub`。改完跑守卫自证。

## 必备命令

```bash
# Unix
make boundary && make layer-deps && make architecture-check
make test-backend
make docs-gen          # 从代码重生 api-endpoints / tool-catalog / makefile-targets
make docs-gen-check    # CI：生成物是否过期
make ci-local          # 本地完整 CI 等价

# Windows PowerShell
powershell -File Makefile.ps1 -Task test-backend
powershell -File Makefile.ps1 -Task boundary
powershell -File Makefile.ps1 -Task layer-deps
```

真 LLM 冒烟（默认排除）：`RUN_LIVE_LLM=1 make test-live`（需真实 `LLM_API_KEY`）。

命令全表：[`docs/06-reference/makefile-targets.md`](docs/06-reference/makefile-targets.md)（自动生成）。

## 改完必跑

| 改动类型 | 必跑 |
|---|---|
| 任意后端 | `make test-backend` + `make lint` |
| Kernel / 投影 / 表 | `make boundary` + `make projection-provenance` + `make rebuild-verify` |
| 层依赖 / 导入 | `make layer-deps` |
| 概念面（事件/fragment/runtime 文件） | `make architecture-check`；若指标下降再 `python -m scripts.check_concept_growth --ratchet --yes` |
| API 路由 / MCP 配置 / Makefile | `make docs-gen` |
| 文档链接 | `make docs-links` |

## 提交

Conventional Commits（`.githooks/commit-msg` 强制）：`feat|fix|docs|style|refactor|perf|test|chore|revert`。

用户偏好见 [`.harness/user-preferences.md`](.harness/user-preferences.md)。
