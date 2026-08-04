# 工程约定

> 浓缩自 `docs/05-engineering/`（development / testing / ci-cd）与钩子实现。权威细节见各文档。

## 提交（commit-msg 钩子强制）

- **Conventional Commits**：`^(feat|fix|docs|style|refactor|perf|test|chore|revert)(\(scope\))?: <subject>`
- subject 长度 2–100，**禁止以句号结尾**。
- 示例：`feat(harness): add agent workspace docs`

## 后端

- Python ≥ 3.12；`line-length = 100`；ruff select `["E","F","W","I"]`、ignore `["E501"]`。
- mypy：`python_version="3.12"`、`ignore_missing_imports=true`、`check_untyped_defs=true`、`follow_imports="normal"`。
- 运行依赖以 `backend/requirements.txt` 为权威，全部 exact pins；`requirements-dev.txt` 在之上追加最小工具集。
- **改依赖**：`pyproject.toml` + `requirements.txt` 同步 → `make dependency-sync` → `make lockfile`（见 `architecture-redlines.md §7`）。

## 测试

- 后端测试放 `backend/tests/`，pytest，`-m "not live_llm"` 为常规门（live_llm 单独跑）。
- 前端：`tsc --noEmit && npm test`（Vitest）。
- e2e：Playwright；`test-e2e-real` 用真实 backend + fake LLM。

## 文档

- 叙述用中文，代码标识符 / 路径 / 命令保留英文原文。
- 相对链接交叉引用，避免内容重复；每篇文档表述"与代码一致，以代码为准"。
- 概念红线数字只作为 CI 契约出现，不作规模预测。
- 架构行为变更必须同步 docs（`docs-links` / `docs-table-sync` / `docs-line-refs` / `docs-numbers` 守护）。

## 工作流程

- 编辑代码前先读相关文件；小改动用 patch，新文件 / 全量重写用 write。
- 提交前建议：`make lint && make typecheck && make test-backend`（改动架构时加不变量目标）。
- 本地完整 CI 等价：`make ci-local`。

## Windows 注意

- 仓库提供 `Makefile.ps1`（子集目标，顺序执行）。macOS/Linux 用 `make`。
- `make dev` 依赖 bash 脚本 `scripts/wait_for_health.sh`，Windows 请用 `Makefile.ps1 -Task` 或 WSL。
