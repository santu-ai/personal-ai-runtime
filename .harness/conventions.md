# 工程约定

> 权威细节在 [`docs/05-engineering/`](../docs/05-engineering/)（development / testing / ci-cd）。本文件只保留 agent 高频约束，避免第二套 SSOT。

## 提交（commit-msg 钩子强制）

- Conventional Commits：`^(feat|fix|docs|style|refactor|perf|test|chore|revert)(\(scope\))?: <subject>`
- subject 长度 2–100，**禁止以句号结尾**

## 最短检查清单

- 后端：`make lint && make test-backend`（`-m "not live_llm"` 为默认门；真 LLM 用 `make test-live`）
- 改依赖：`make dependency-sync` → `make lockfile`（见 [architecture-redlines.md](architecture-redlines.md) §7）
- 改架构：`make boundary && make layer-deps && make architecture-check`
- 本地完整 CI：`make ci-local`
- Windows：先读 [powershell-tips.md](powershell-tips.md)；子集任务用 `Makefile.ps1`

## 文档生成脚本纪律（`docs/06-reference/` 自动生成部分）

- 生成脚本写文件统一 `newline="\n"`（`OUT.write_text(..., encoding="utf-8", newline="\n")`），避免 Windows CRLF 污染 git diff。
- `gen_api_docs.py` 的认证豁免 import `app.main` 的 `SKIP_AUTH_EXACT`/`SKIP_AUTH_PREFIXES`，**不要手抄清单**；新增公共端点改 main.py 常量，而不是生成脚本。
- 改生成源（API 路由 / Makefile / `capability_policy.json` / `mcp_*`）后必须 `make docs-gen && make docs-gen-check`。
- 概念压缩基线操作见 [task-recipes.md](task-recipes.md) §7（`--ratchet --yes`）。

文档语言与交叉引用纪律见 [`docs/05-engineering/development.md`](../docs/05-engineering/development.md)。
