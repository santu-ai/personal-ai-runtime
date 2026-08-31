# CI / CD

本文档描述持续集成与发布的全部配置。

## GitHub Actions 工作流

### `workflows/ci.yml`

push/PR 到 `main` 时触发，六个 job：

**`secrets-scan` job**：`gitleaks/gitleaks-action@v3`，配置 [`.gitleaks.toml`](../../.gitleaks.toml)，`fetch-depth: 0`。

**`backend` job**（Python 3.12）：

1. 在安装任何包之前运行 `python -m scripts.check_dependency_sync`，确保 `pyproject.toml` 运行时依赖与权威 `requirements.txt` 完全一致，并验证 lock 中记录的依赖输入 SHA-256，拒绝新增、修改或删除依赖后的陈旧 lock。
2. `python -m pip install --require-hashes -r requirements.lock`；锁文件同时覆盖运行时依赖和 `requirements-dev.txt` 中 exact-pinned 的 pytest/ruff/mypy/coverage 工具。
3. 运行唯一的后端核心入口 `make backend-ci-core`：先 `backend-ci-static` 再 `backend-ci-runtime`，两波均 `make -j$(JOBS)` 并行。清单由 `BACKEND_CI_STATIC` / `BACKEND_CI_RUNTIME` 维护，`make ci-local` 复用同一入口。覆盖 compileall、ruff、mypy、pytest coverage、Alembic、API/MCP smoke、version、policy、文档、边界/层依赖/归属、架构与全部 rebuild/export/egress/connector/vector/repair/tool-calls verify。

**`dependency-platforms` job**：在 `ubuntu-latest` / `macos-latest` / `windows-latest` 上执行依赖同步检查与 `--require-hashes` 安装，确保同一份 lock 可在三大平台安装（含 Windows 条件依赖与 Chroma 二进制包）。

**`frontend` job**（Node 22；前端 Docker 构建镜像仍是 `node:20-slim`）：

1. `npm ci`。
2. `tsc --noEmit`。
3. `npm run lint`（`eslint src/ && prettier --check src/`）。
4. `npm test`（vitest）。
5. `npm run build`（`tsc -b && vite build`）。
6. `npx playwright install chromium`。
7. `npm run test:e2e`。

**`desktop` job**（Node 22）：

1. `npm ci --ignore-scripts`，跳过 Electron binary 下载等 smoke 不需要的安装脚本。
2. `make desktop-test`，运行现有 vitest Electron main-process smoke；测试只解析和检查源码，不打包 Electron，因此无需执行重量级 desktop build。

**`real-backend-e2e` job**（Python 3.12 + Node 22）：安装 backend lock 与 frontend 依赖后，跑 `npm run test:e2e:real`（真后端 Playwright）；失败时上传 `frontend/test-results/` traces。

### `workflows/release.yml`

tag `v*.*.*` 触发：

1. 提取版本号。
2. 内联 Python 脚本从 `CHANGELOG.md` 切出对应版本段落。
3. `softprops/action-gh-release@v3` 创建 GitHub Release。
4. tag 含 `-` 标记为 prerelease。

> `CHANGELOG.md` 位于仓库根目录（Keep a Changelog 格式），由 [`release.yml`](../../.github/workflows/release.yml) 切版本段落生成 GitHub Release notes。

## Dependabot

[`.github/dependabot.yml`](../../.github/dependabot.yml)：

- **每周一**：`pip`（backend，labels `dependencies` + `backend`）、`npm`（frontend，labels `dependencies` + `frontend`）、`npm`（desktop，labels `dependencies` + `desktop`）。
- **每月**：`github-actions`（labels `dependencies` + `ci`）。
- commit-message prefix 分别为 `deps(backend)` / `deps(frontend)` / `deps(desktop)` / `deps(ci)`。

## Git Hooks

[`.githooks/`](../../.githooks/) + 安装脚本 [`scripts/install_hooks.sh`](../../scripts/install_hooks.sh) / [`scripts/install_hooks.ps1`](../../scripts/install_hooks.ps1) / [`install-hooks.cmd`](../../install-hooks.cmd)（Windows shim，绕过执行策略调 PowerShell 安装器）。

安装：`make install-hooks`（设 `core.hooksPath=.githooks` 并 chmod）。

### `pre-commit`

收集暂存的 backend `.py`（`git diff --cached --name-only --diff-filter=ACM`），跑 `ruff check` 然后 `mypy app/ scripts/ --ignore-missing-imports`。无 Python 暂存则提前退出。

### `commit-msg`

强制 Conventional Commits。正则：

```
^(feat|fix|docs|style|refactor|perf|test|chore|revert)(\([a-zA-Z0-9._/-]+\))?: .{2,100}$
```

拒绝以句号结尾的 subject。失败时打印期望格式与示例。

## 本地 CI 等价

```bash
make ci-local
```

`ci-local` 复用 CI 调用的 `backend-ci-core`，并追加 frontend 单测/E2E、real-backend E2E 与 desktop smoke。后端清单只有 Makefile 的 `BACKEND_CI_TARGETS` 一个维护点；完成打印「ci-local checks passed」。

合并门槛（每个 PR 必须过，比 `ci-local` 更短）：

```bash
make merge-gate
# Windows: powershell -File Makefile.ps1 -Task merge-gate
```

覆盖后端 **coverage 门**测试（`test-backend-coverage`：runtime≥75、api≥50、harness≥66、product≥79）、前端测试与构建、`boundary`、`layer-deps`、`projection-provenance`、`rebuild-verify`。

## Windows 支持

[`Makefile.ps1`](../../Makefile.ps1) 是 PowerShell 等价，`switch` on `$Task`。提供：`help`、`install`、`install-hooks`、`test-backend`、`test-frontend`、`lint`、`typecheck`、`boundary`、`layer-deps`、`architecture-check`、`event-schema`、`backend-ci-static`、`backend-ci-runtime`、`backend-ci-core`、`projection-provenance`、`rebuild-verify`、`alembic-verify`、`docs-gen` / `docs-gen-check`、以及与 Unix `Makefile` 对齐的单进程/动态导入/except 卫生守卫。**不提供** Unix 的 `dev` 聚合任务（需手动开两个终端跑前后端）。

注意：Windows `typecheck` 与 Unix Makefile 一致（`mypy app/ scripts/ --ignore-missing-imports`）。未知任务报错。

## 密钥扫描

[`.gitleaks.toml`](../../.gitleaks.toml) 扩展默认规则集，两个 allowlist：

1. `.env.example`、`docs/*.md`、`.harness/*.md`、`README*.md`、`CONTRIBUTING.md` 中的示例/模板值，加已知占位符（`your-deepseek-api-key`、`your-gmail-app-password`、`your-email@gmail.com`、`sk-test-key`、`demo-seed`、`placeholder-not-a-secret`）。
2. 历史 fingerprint：egress 测试假密钥（`b118877`）与 Compose 冒烟里 RFC 6455 示例 `Sec-WebSocket-Key`（`ec5184f`）。工作树已改为运行时随机 nonce；merge 扫描仍会看到旧 patch。占位符 regex 含该 RFC 样例 Base64。

不放行整个 `backend/tests/` 目录。

本地：`make secrets-scan`。
