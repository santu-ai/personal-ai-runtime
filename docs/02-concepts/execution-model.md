# Execution Model（三车道）

Personal AI Runtime 的所有执行路径用**一套三车道语义**解释。不要再引入平行的「Agent 调度 / 旁路 RPC / 特殊循环」叙事。

## 定义

| Lane | 名称 | 是什么 | 入口 | 持久化 |
|------|------|--------|------|--------|
| **A** | Scheduled Work | 一次 Handler 调用（`ScheduledExecution`） | `emit_event` → Scheduler fan-out | `handler_executions` + Execution* 事件 |
| **B** | Sync Capability | 受治理的外部效果 | `Kernel.invoke_capability` | Capability* 事件（不经 Scheduler） |
| **C** | Maintenance | 时钟驱动的组合动作 | `RuntimeLoop` / `@reaction` | 仅当其 emit / invoke 时进入 A 或 B |

## 概念对照

| 说法 | 含义 |
|------|------|
| 一次 **ScheduledExecution** | Lane A：一个 handler × 一个触发事件 |
| 一次 **Work（领域）** | `work_items` 投影行（goal / task / action）——与 Lane A 不同名不同表 |
| 一次 **Capability Invocation** | Lane B：门控 + `mcp_hub.invoke_tool` + 审计事件 |
| Runtime 调度 | Lane A Scheduler + Lane C RuntimeLoop |
| 同步调用 | Lane B（及 `submit_command` 对完成事件的 Future 等待） |
| 异步执行 | Lane A（async dispatcher → ScheduledExecution） |

## 不变量

1. **一事件可扇出 N 个 Lane A 执行**：`HandlerRegistry` 对同一 `event.type` 保留 handler 列表；Scheduler 为每个 handler 建一个 `ScheduledExecution`。
2. **Lane B 不是 WORK**：工具循环需要同步返回值；CAPABILITY 与 WORK 是不同原语（见 [runtime-algebra.md](runtime-algebra.md)）。
3. **Lane C 不是新原语**：Reaction / timer maintenance 是 `subscribe + emit/invoke` 的组合。
4. **GOVERNED 状态只经投影写入**：包括审批过期（emit `ApprovalDenied` + projector）。
5. **流式输出走 TRANSPORT**：Lane A/B 执行过程中的 `text_delta` 等瞬时信号经 Transport 推送，不进入 `event_log`（见 [runtime-algebra.md §1.6](runtime-algebra.md)）。

## 控制面原语（Control Plane）

单进程 asyncio 控制面（**非目标**：分布式 lease / 多 worker）；启动时对 `{sqlite_path}.lock` 加单实例文件锁，运行时强制单进程（INV-W6）。强度与测试锚点：

| Primitive | Status | Evidence / guard |
|-----------|--------|------------------|
| Retry | Present | Lane A `_maybe_retry` + ExecutionRetried；`test_scheduler*` / policy |
| Cancellation (mid-flight) | Present (durable) | `Scheduler.request_cancel` → ExecutionFailed before `task.cancel`；BG via WorkItemStatusChanged；`test_background_control_plane` |
| Recovery | Present | `recover_scheduled_executions` + 没有 handler 行的 BG running→pending；非 goal 且带 `executable_plan` 的 task/action 若已是 running 但还没有 handler 行，补一次 `ExecuteRequested`；goal 或没有计划则跳过。已结束的 handler 不重跑。该请求的 handler 都已终态且至少一条失败时，把仍为 running 的 Work 收成 `failed`（不另开一轮 retry 预算）。`ExecuteCompleted` 能对上同一次请求时，同步 Work 状态。interrupted 重放计入 retry 预算（超限走 ExecutionFailed / DLQ，不再重放）。`kernel.expire_stale_running_leases` 在终态死信时走与 Scheduler 相同的领域 Work 收口，但不重新入队剩余重试；scheduler/runtime_loop tests |
| Lease / multi-worker ownership | Absent / **Non-goal** | 单进程；见 [runtime-invariants.md](runtime-invariants.md) INV-W6；`check_single_process_control_plane.py` |
| Quota | Partial | HTTP/WS rate limits；tool-loop token/iteration caps；无 per-tenant scheduler quota |
| Backpressure | Present | `scheduler_max_pending` → `queue_full` |
| Durable continuation | Yes | `plan_resumes` for Execute/Approve；再次运行或返工清游标前写入 `rerun_stash:{work_id}`，半开恢复放回。返工收回打开前的 `completed` 或 `failed`（`reason=rework_restore`），不用 `rerun_restore`。Chat 工具环 `chat_ckpt:{correlation_id}` 供 interrupt 重放与审批后续写（ADR-R011） |

## 负空间登记（Negative Space）

| Missing primitive | Status | Notes |
|-------------------|--------|-------|
| Distributed lease | Non-goal | Personal single-process Runtime |
| Multi-worker Scheduler | Non-goal | Same process as FastAPI lifespan |
| Chat tool-loop cursor across restart | Yes | `chat_ckpt:{correlation_id}` + Scheduler interrupt replay；审批 resolve 恢复同一工具环 |
| Multi-tenant isolation | Non-goal | Single-user Principal model |

## 生命周期对照（Work / Execution / PlanResume）

| Concept | Create | Start | End | Retry | Recover | Destroy/GC |
|---------|--------|-------|-----|-------|---------|------------|
| **ScheduledExecution** | ExecutionRequested | ExecutionStarted | Completed/Failed | ExecutionRetried (Lane A) | running→retrying→pending；retry 预算尽则 ExecutionFailed / DLQ | Soft-prune terminal rows (`handler_executions_retention_days`) |
| **WorkItem** | WorkItemCreated | StatusChanged(running) 或用户 pending→completed | completed/cancelled | Domain re-open: failed→pending、completed→pending；running 且最新 `status=running` 之后的 `ExecuteRequested` 已失败时可再次 `ExecuteRequested` | 无 handler 行的 BG running→pending；有计划的 task/action 在 running 且无 handler 行时补 `ExecuteRequested`；goal 或没有计划则跳过。该请求的 handler 都已终态且至少一条失败则收成 `failed`。pending 且 `reason=rework_restore`、其后没有 `ExecuteRequested` 时收回打开前的 `completed` 或 `failed`，并放回 `rerun_stash` | Domain delete events |
| **PlanResume** | register on pending approval | — | take on approve/deny | — | SQLite durable | clear on cancel/deny/expire |
| **Chat tool loop** | ChatRequested | Brain.chat_stream | ChatCompleted / confirmation_required | Lane A `max_retries=2` | `chat_ckpt:{correlation_id}` on interrupt replay | — |

Domain FSM 不含 `retrying`；操作层重试由 Lane A（`ScheduledExecution`）独占。任务详情的 `handler_execution` 与死信收口用同一条边界：只认最新 `status=running` 之后的 `ExecuteRequested`。这条请求还没有 handler 行时快照为空，不把上一轮失败当成当前尝试。handler 在请求之后补写的 `status=running`（`caused_by` 指向该请求）仍属于这一次。
