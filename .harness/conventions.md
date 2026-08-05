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

## 测试隔离与行为断言

- **模块级单例绑定是测试隔离的坑**：`from kernel_instance import kernel` 在模块级绑定后，若在 `ki.kernel` 被 monkeypatch 成 concrete 实例期间首次 import，会冻结旧 Kernel 引用，跨测试泄漏（写入落旧 DB、读取落新 DB）。测试出现"跨测试偶发失败"先怀疑这类绑定；conftest `_reset_runtime` 已恢复 `ki.kernel` 与 `work_item_engine.kernel` 为 LazyProxy。
- **行为测试先锁定真实行为，再判断对错**：断言失败先读实现确认是"测试假设错误"还是"产品 bug"。已被测试锁定的真实语义（如 cascade 不递归孙级）不要按直觉改断言，应作为产品决策单独立项。
- **修复"已锁定的现状"要同步更新锁定测试**：若产品决策改变了一个被测试锁定的行为（如 `notify_goal_action_completed` 从"0/0 噪音通知"改为"无子项跳过通知"），必须同步改写对应锁定测试为新行为，而不是留旧测试继续锁旧行为；修复先判定等价性（逐分支比对），再改测试。
- **测防御分支用 fake kernel 直接构造输入**：真实 `query_state` 会在 SQL 层过滤掉非法输入（如非法日期字符串），测不到防御逻辑；用 fake kernel 注入这类行来锁定回退行为。

## 工具索引滞后陷阱（本次实测两次）

- IDE 的 Grep/Glob/Read 索引**可能滞后于磁盘**：文件已删除/重命名但 grep 仍显示存在（或反之）。本次 `task_engine.py`、`frontend/src/api/goals.ts` 均被 grep 报存在含 `parent_goal_id`，**磁盘上实际不存在**。
- **裁决以磁盘为准**：搜到可疑残留时，先用 `Test-Path` / `cmd /c dir /b <dir>` 核实文件真实存在，再决定是否动手。避免基于 stale 索引做"删除/修复"导致白改或误删。
- 同理，重命名/删除类全仓清理后，验证也要用磁盘扫描（`Get-ChildItem ... | Select-String`）而不是 grep 结果作为"清零"证据。

文档语言与交叉引用纪律见 [`docs/05-engineering/development.md`](../docs/05-engineering/development.md)。
