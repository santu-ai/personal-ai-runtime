# 项目地图

> 目录树与文档索引的权威版见 [`docs/README.md`](../docs/README.md)。本文件只保留**任务→代码**快捷定位。

## 三大入口

| 子系统 | 入口 |
|---|---|
| 后端 | `backend/app/main.py` → `app` |
| 前端 | `frontend/src/main.tsx` |
| 桌面 | `desktop/main.js` |

## 关键代码位置

| 任务 | 位置 |
|---|---|
| 事件 / 投影器 | `backend/app/core/runtime/kernel/`（`emit_event`、`projectors_*.py`） |
| 读端口 | `backend/app/core/runtime/read_ports/` |
| 新增 Capability / 工具 | `backend/app/core/harness/builtin_registration/` + `mcp_config.json` |
| 工具实现 | `backend/app/core/harness/builtin_tools/` 或 Product 侧 |
| Fragment 注册 | `backend/app/fragments/register.py` |
| 审批 / 治理 | `backend/app/core/runtime/capability_governance.py` |
| 领域 API | `backend/app/api/` |
| LLM 出口审计 | `backend/app/core/runtime/egress/egress_gate.py` |
| MCP 网格 | `backend/app/core/harness/mcp_mesh.py`、`mcp_lifecycle.py` |

## docs 指针

| 想了解 | 读 |
|---|---|
| 整体架构 | `docs/01-overview/architecture.md` |
| 六原语 / 概念压缩 | `docs/02-concepts/runtime-algebra.md` |
| 工程操作 | `docs/05-engineering/` |
| API / Makefile / 工具目录 | `docs/06-reference/`（`api-endpoints` / `makefile-targets` / `tool-catalog`，均可 `make docs-gen`） |
| ADR | `docs/07-adr/`（摘要：[decision-log.md](decision-log.md)） |
