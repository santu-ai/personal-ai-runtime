# 决策日志（ADR 一行式摘要）

> 完整决策记录见 [`docs/07-adr/`](../docs/07-adr/README.md)。此处只留"决策 + 影响"一行式，用于快速判断改动是否触及某条决策。

| ID | 决策（一句话） | 对你的影响 | 状态 |
|---|---|---|---|
| [R009](../docs/07-adr/ADR-R009-single-process-control-plane.md) | 单进程控制面：Scheduler/RuntimeLoop/cancel flags 跑在 FastAPI 同进程，不做分布式 lease 或多 worker | 别引入第二控制面 worker 入口（CI 守护 `single-process-control-plane`） | Yes |
| [R010](../docs/07-adr/ADR-R010-durable-lane-a-cancel.md) | Lane A 取消先 emit `ExecutionFailed(cancelled)` 再 `task.cancel()` | 取消意图要进 governed 投影，恢复路径才能跳过 | Yes |
| [R011](../docs/07-adr/ADR-R011-chat-approval-continuation.md) | 审批后续写为 one-shot（已批准工具 + `continue_after_tool_result`），不跨进程重开完整 Brain 工具环 | 进程死亡后不能静默续跑多步 tool loop | Yes |
| [R012](../docs/07-adr/ADR-R012-god-subsystem-budgets.md) | 保留 God façade LOC 红线，另对 `query_builder`/`sovereignty_ops`/`builtin_registration` 锁定分项预算 | 抬预算需改脚本 + docs §4.4 同步 | Yes |
| [R014](../docs/07-adr/ADR-R014-handler-executions-soft-prune.md) | `handler_executions` 终端态过期行可被 Kernel-space soft-prune（维护特权），不删 `event_log` | 与「投影只由 projector 写入」字面冲突→已登记为唯一维护特权例外 | Yes until event compaction |
| [R015](../docs/07-adr/ADR-R015-policy-register-idempotent.md) | Policy 注册幂等：MCP 重启默认 in-memory 清理（`persist=True` 才持久 revoke），避免 event_log 被 Created/revoked 刷屏 | 显式移除工具必须调 revoke；历史污染用 `compact_policy_events --apply`（需备份） | Accepted |
| [R016](../docs/07-adr/ADR-R016-defer-mcp-v2.md) | 已迁移至 `mcp==2.0.0`：snake_case 字段、`MCPServer`、`MCPError` 回传 | v1 外部 stdio server 靠 v2 client `mode='auto'` 回退握手；字段命名用 snake_case | 已执行 |

## 判断提示

改到以下领域前，先回读对应 ADR 全文：
- **调度/取消** → R009、R010
- **审批流** → R011
- **投影表维护/DML** → R014（维护特权例外，别扩大）
- **MCP 生命周期** → R015、R016
