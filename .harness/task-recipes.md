# 高频任务 SOP

> 每个任务给出"步骤 + 落地检查"。扩展点细节见 `docs/05-engineering/extending.md`。

## 1. 新增投影器 / 事件类型

1. 确认是否真的需要新事件（概念压缩：能否复用现有原语？）。
2. 在 Kernel 内写投影器（`projectors_*.py`），**不要**在 Kernel 非投影路径对 GOVERNED 表做 DML。
3. 注册 projector（`projectors_registry.py` 等）。
4. 检查：`make boundary && make projection-provenance && make rebuild-verify`。
5. 若影响概念计数 → `make architecture-check`；同步 docs（事件溯源 / 数据模型 / 相关概念文档）。

## 2. 新增 Context Fragment

1. 在 `backend/app/fragments/` 下实现（领域逻辑，Product 侧）。
2. 在 `backend/app/fragments/register.py` 注册。
3. 遵守 read boundary：Product 读 governed 数据必须经 Kernel ABI / `read_ports`。
4. 补测试：`backend/tests/test_fragment_read_boundary.py` 等。
5. 检查：`make test-backend`；若改概念 → `make architecture-check`。

## 3. 注册 / 修改 MCP 服务器

1. 外部 MCP：改 `backend/mcp_config.json`（agent 可编辑）。
2. 内建工具：注册在 `backend/app/core/harness/builtin_registration/`，实现放 `builtin_tools/` 或 Product 侧。
3. 新能力进 `capability_policy.json` 需专门审批路径（该文件 protected）。
4. 检查：`make backend-smoke`（CORE 注册表派生 + CRITICAL 钉选）或 `verify_api_mcp_smoke.py`；`make test-backend`。
5. 记住 R015/R016：MCP 重启默认 in-memory，显式移除工具必须 `revoke`；字段命名 mcp 2.0 用 snake_case。

## 4. 新增 governed 表

1. `schema_ddl.py` 加表 + 分类（GOVERNED vs APP_STORAGE）→ `kernel-boundary.md` 有表级分类规则。
2. alembic 迁移（`alembic revision`），并 `alembic upgrade head`。
3. 投影写入必须经事件，行内带 provenance。
4. 检查：`make boundary && make projection-provenance && make alembic-verify`。
5. 同步 `docs/04-data/data-model.md` 与概念文档。

## 5. 修改依赖

1. 同步 `backend/pyproject.toml` 与权威 `backend/requirements.txt`（**顺序 + exact pins**）。
2. `make dependency-sync` → `make lockfile`。
3. 检查：CI 的 dependency-platforms 会在 ubuntu/macOS/Windows 装锁文件做 import 冒烟。
4. 更新 `docs/05-engineering/development.md`（锁文件段）如必要。

## 6. 新增 Capability / 工具

1. 确定归属：Capability 基础设施（注册、路由、URL 安全）属 Runtime；工具实现属 Product。
2. 走 `invoke_capability` 入口（勿旁路）；外部效果必须过治理 + egress 审计。
3. 检查：`make execution-ownership`、`make test-backend`、`backend-smoke`。

## 7. 改动 docs

1. 事实类改动必须同步对应文档（SSOT）。
2. 跑 `make docs-links && make docs-table-sync && make docs-line-refs && make docs-numbers`。
3. 新增文档记得加入 `docs/README.md` 索引。

## 8. 提交代码

1. 自检：`make lint && make typecheck && make test-backend`（+ 相关不变量）。
2. commit 用 Conventional Commits，subject 不以句号结尾。
3. 完成后在 `workspace-state.md` 更新一行。
