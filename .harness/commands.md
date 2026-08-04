# 命令速查

> Windows 用户：`Makefile.ps1` 提供子集（`help / install / install-hooks / test-backend / test-frontend / lint / typecheck / boundary / layer-deps / backend-ci-* / docker-up / docker-down`），调用方式 `powershell -File Makefile.ps1 -Task <name>`；PowerShell 下 `backend-ci-*` 为顺序执行（非并行）。完整目标见 [docs/06-reference/makefile-targets.md](../docs/06-reference/makefile-targets.md)。

## 开发循环

| 命令 | 作用 |
|---|---|
| `make dev` | 后台启 uvicorn(8000) + 健康门控 + vite(5173)，阻塞 |
| `make desktop` | `cd desktop && npm start`（Electron） |
| `make init-db` | `alembic upgrade head`（失败容错） |
| `make demo` | 播种演示数据（幂等） |
| `make install-hooks` | 装 `.githooks`（pre-commit + commit-msg） |

## 测试

| 命令 | 作用 |
|---|---|
| `make test` | backend + frontend 单测 |
| `make test-backend` | `pytest tests/ -q -m "not live_llm"` |
| `make test-frontend` | `tsc --noEmit && npm test` |
| `make test-e2e` | Playwright（先 `npx playwright install chromium`） |
| `make test-e2e-real` | 真实 backend + fake LLM 的 SSE/审批 e2e |
| `make ci-local` | 本地完整 CI 等价（推荐提交前跑） |

## 质量门

| 命令 | 作用 |
|---|---|
| `make lint` | `ruff check app/`（line-length 100，select E/F/W/I，ignore E501） |
| `make typecheck` | `mypy app/ scripts/ --ignore-missing-imports` |
| `make dependency-sync` | 校验 `pyproject.toml` 与权威 `requirements.txt` 一致（**改依赖必跑**） |
| `make lockfile` | 重新生成 `requirements.lock`（**改依赖必跑**，固定 `pip-tools==7.5.3`） |
| `make secrets-scan` | gitleaks 全库扫描 |

## 架构不变量（改架构相关代码后必跑）

| 命令 | 守护内容 |
|---|---|
| `make boundary` | Kernel 边界静态扫描（GOVERNED 表 DML 越权） |
| `make layer-deps` | Runtime/Product/Store/API 职责边（R1–R4） |
| `make execution-ownership` | `invoke_capability` 必带 `execution_id` |
| `make architecture-check` | 概念压缩 BASELINE + docs §4.4 同步 + G2 子系统 LOC |
| `make projection-provenance` | 投影行有对应 `event_log` 事件 |
| `make rebuild-verify` | 旗舰：全量重建字节一致 |
| `make vector-consistency-verify` | SQLite memories vs Chroma 对账 |
| `make single-process-control-plane` | 禁止第二控制面 worker 入口 |
| `make dynamic-imports` | importlib 旁路 AST 守卫 allowlist |

## 文档检查（改了 docs 后跑）

| 命令 | 守护内容 |
|---|---|
| `make docs-links` | 文档相对链接与路径存在 |
| `make docs-table-sync` | 文档表清单与 registry 同步 |
| `make docs-line-refs` | 禁止易漂移的 Python 行号引用 |
| `make docs-numbers` | 文档数字与代码一致 |

## 容器 / 其他

| 命令 | 作用 |
|---|---|
| `make docker-up` / `make docker-down` | Docker Compose 起停 |
| `make screenshots` | `cd docs/assets` Playwright 截图 |

## 高频快捷组合（提交前）

```bash
make lint && make typecheck && make test-backend
# 若动了架构/事件/依赖：再加
make boundary && make layer-deps && make projection-provenance
make ci-local
```
