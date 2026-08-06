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
- **`monkeypatch.undo()` 会撤掉 fixture 隔离**：pytest 的 `monkeypatch.undo()` 撤销**该 fixture 上全部** patch（含 `product_kernel` 等隔离）。局部失败场景用 `with monkeypatch.context() as m:`，不要在测完后 `undo()` 再读隔离库。

## TimerFired / Lane A 长 I/O

- `TimerFired` 默认 `ExecutionPolicy` **timeout=30s**（`policy_for_event` 仅对 `ChatRequested` 加长）。
- 凡在 timer handler 里做网络抓取、IMAP、批量外呼等可能 >数秒的工作：**禁止在 `_TIMER_HANDLERS` 里直接 await 完整 I/O**。
- 既有样板：`inbox_poll`（emit 事件交给独立 WorkItem）、`url_monitor`（`asyncio.create_task` fire-and-forget + 强引用集合）。cron 路径再加**每 tick 上限**，避免 backlog 一次打满。
- 手动 HTTP「立即执行」端点同样要 cap（或异步化），否则会挂死请求。

## APP_STORAGE 共享 JSON 配置

- 多个产品能力可共享同一 `app_settings` category（例：`monitors` 下 `inbox_filters` + `url_monitors`），**零新 governed 表/事件**。
- 部分更新必须 merge；**merge 用的 load 失败要抛错中止写入**，禁止「读失败 → 空 dict → 把兄弟列表写成 `[]`」。
- UI/列表只读路径可以 soft-load（失败返回空）；写路径必须 strict。通知去重优先复用 `dedup_key`（见 `notification_bridge`），不要另造幂等表。

## 投影查询（`query_builder`）

- 投影读路径一律走 `safe_limit` / `safe_order` / `build_where` / `in_clause`，禁止手插 `LIMIT ?` 或把未白名单的 `order` 插进 SQL。
- 空 `IN (...)` 列表用 `1 = 0`（或短路返回空），不要拼出非法 SQL。
- 未知 `order` key 必须回退到显式 `default_key`；改兜底语义前先核对历史调用约定。

## God 文件与概念压缩

- `query_builder` / `main` / `mcp_mesh` / `agent_scheduler` 等受 `runtime_files` / 概念压缩零和约束（见 [decision-log.md](decision-log.md) R012）。
- 优化时优先**单文件内**抽 helper；拆文件必须同变更删除等价概念，并按 [task-recipes.md](task-recipes.md) §7 `--ratchet --yes`。

## 工具索引滞后陷阱（本次实测两次）

- IDE 的 Grep/Glob/Read 索引**可能滞后于磁盘**：文件已删除/重命名但 grep 仍显示存在（或反之）。本次 `task_engine.py`、`frontend/src/api/goals.ts` 均被 grep 报存在含 `parent_goal_id`，**磁盘上实际不存在**。
- **裁决以磁盘为准**：搜到可疑残留时，先用 `Test-Path` / `cmd /c dir /b <dir>` 核实文件真实存在，再决定是否动手。避免基于 stale 索引做"删除/修复"导致白改或误删。
- 同理，重命名/删除类全仓清理后，验证也要用磁盘扫描（`Get-ChildItem ... | Select-String`）而不是 grep 结果作为"清零"证据。

文档语言与交叉引用纪律见 [`docs/05-engineering/development.md`](../docs/05-engineering/development.md)。
