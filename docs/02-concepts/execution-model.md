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
| Recovery | Present | `recover_scheduled_executions` + 没有 handler 行的 BG running→pending；非 goal 且带 `executable_plan` 的 task/action 若已是 running 但还没有 handler 行，补一次 `ExecuteRequested`；goal 或没有计划则跳过。已结束的 handler 不重跑。该请求的 handler 都已终态且至少一条失败时，把仍为 running 的 Work 收成 `failed`（不另开一轮 retry 预算）。`ExecuteCompleted` 能对上同一次请求时，同步 Work 状态。interrupted 重放计入 retry 预算（超限走 ExecutionFailed / DLQ，不再重放）。`kernel.expire_stale_running_leases` 在终态死信时走与 Scheduler 相同的领域 Work 收口，但不重新入队剩余重试。启动另扫 pending：`reason=rerun_restore` 且其后没有 `ExecuteRequested` 收回 `completed`；`reason=rework_restore` 收回打开前的 `completed` 或 `failed`。`replay_dead_letters` 在对应领域 Work 已是 `failed` / `completed` / `cancelled` 时不把该死信再排成 pending（日志 `reason=work_terminal:<status>`，不发 Execution*）；不是当前尝试的死信同样跳过（`not_current_attempt`）。handler 在请求之后补写的 `status=running`（`caused_by` 指向该请求）仍算当前尝试，不因此记成 `not_current_attempt`。没有对应 Work 的执行仍可重放。详见下文；scheduler/runtime_loop tests |
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
| **WorkItem** | WorkItemCreated | StatusChanged(running) 或用户 pending→completed | completed/cancelled | Domain re-open: failed→pending、completed→pending；running 且当前尝试的 `ExecuteRequested` 已失败时可再次 `ExecuteRequested`（含 handler 事后补写 running、`caused_by` 指向该请求） | 无 handler 行的 BG running→pending；有计划的 task/action 在 running 且无 handler 行时补 `ExecuteRequested`；goal 或没有计划则跳过。该请求的 handler 都已终态且至少一条失败则收成 `failed`。审批恢复先写请求、再补 running 时，这一条仍算当前尝试，不当成没有 handler。pending 且 `reason=rerun_restore`、其后没有 `ExecuteRequested` 时收回 `completed` 并放回 `rerun_stash`。pending 且 `reason=rework_restore`、其后没有 `ExecuteRequested` 时收回打开前的 `completed` 或 `failed`，并放回同一暂存 | Domain delete events |
| **PlanResume** | register on pending approval | — | take on approve/deny | — | SQLite durable | clear on cancel/deny/expire |
| **Chat tool loop** | ChatRequested | Brain.chat_stream | ChatCompleted / confirmation_required | Lane A `max_retries=2` | `chat_ckpt:{correlation_id}` on interrupt replay | — |

Domain FSM 不含 `retrying`；操作层重试由 Lane A（`ScheduledExecution`）独占。当前尝试、半开收回、死信重放和单次交付成本见下一节。不新增事件类型。

## 当前尝试、半开收回与单次交付成本

`e863c8f`、#117–#123 与 #125 把再次运行、返工、死信收口和审批恢复补写的 running 收成同一条「当前尝试」边界。事实在既有事件 payload 与 `plan_resumes` 合成键上，不新增事件类型、投影表或 Kernel 方法。任务页与 API 的呈现见 [frontend.md](../03-subsystems/frontend.md)、[backend-api.md](../03-subsystems/backend-api.md)；启动扫描见 [backend-core.md](../03-subsystems/backend-core.md)；键形状见 [data-model.md](../04-data/data-model.md) 与 [ADR-R017](../07-adr/ADR-R017-execution-trustworthiness.md) E-3 / E-5。

### 当前尝试

当前尝试是最新一条 `ExecuteRequested`，并且它要么排在最新一条 `status=running` 之后（`request_work_item_execute` 先写 running，再写请求），要么就是引起这条 running 的请求。审批恢复（`_dispatch_plan_resume`）在 Work 仍为 `waiting_approval` 时先写 `ExecuteRequested`，执行 handler 再补 `WorkItemStatusChanged(running)`，`caused_by` 指向该请求。补写之后请求的 seq 不再大于最新 running，但它仍是当前尝试。更早的请求，或 `caused_by` 对不上这条请求的 running，属于上一轮。`_current_execute_requested` 与任务详情的 `_snapshot_execute_requested` 是同一函数。

这条边界同时用于：

- 启动恢复（`_recover_interrupted_background_tasks`）：只看这一条请求的 handler。都已终态且至少一条失败时，仍为 running 的 Work 收成 `failed`，不重新排队，也不另开一轮 retry 预算。能对上同一次 `ExecuteCompleted` 时同步状态。还没有 handler 行时，后台任务回到 pending；有 `executable_plan` 的 task/action 补一次 `ExecuteRequested`；goal 或没有计划则跳过。审批恢复补写 running 之后，已有 handler 的那条请求不当成「还没派发」。
- 当场死信收口（`close_dead_lettered_domain_work`）与 `kernel.expire_stale_running_leases` 的终态死信：只在该死信就是这一条请求、且该请求的 handler 都已终态并至少一条失败时，把仍为 running 的领域 Work 收成 `failed`。更早一次请求不会收口后来进入 running 的尝试。
- `latest_execute_handler_failed`：这一条请求的 handler 都已终态且至少一条失败时为真。还没派发出去、或仍有未结束 handler 时为假。任务页据此把「重新执行」和上一轮失败分开。
- 任务详情快照（`work_item_execution_snapshot`）：同一判定。这条请求还没有 handler 行时 `handler_execution` 为空，不把上一轮失败当成当前尝试。上面的事后 running 对快照、启动恢复、死信收口、`latest_execute_handler_failed` 和死信重放都算这一次。

### 再次运行的半开收回

`rerun_project_brief` 把已完成且已有交付的项目简报收成 pending，payload 为 `reason=rerun_restore`，然后清计划游标并走既有 `ExecuteRequested`。不写评审决定，不追加返工笔记。计划在打开前就不能执行时不改状态。当前交付保持不变。定时到点走同一条路径。

Kernel 每次 emit 单独提交，所以打开和派发不是一个事务。打开之后、`ExecuteRequested` 还没落库时：

- 清计划游标本身失败：用同一条 `WorkItemStatusChanged(completed, reason=rerun_restore)` 收回。这次清没有提交，不拿空快照去写游标。
- 清游标已提交、随后执行请求失败：同样收回 `completed`（同一 reason），并把刚才清掉的游标从调用方快照放回，同时删掉暂存。
- 进程死在打开之后、执行请求落库之前：启动时 `_restore_half_open_reruns` 扫描 `status=pending`。最近一次状态是 `reason=rerun_restore`、且其后没有 `ExecuteRequested` 时，放回 `rerun_stash:{work_id}`（原行还在则只删暂存），再 emit 同一条 `completed`。

`reason=rerun_restore` 不是新的完成。依赖钩子（`_on_work_item_status_changed`）看到这个 reason 直接返回，不把列出这一项的后继标成 `running`。`read_ports.compare_periods` 的完成计数同样排除它（`rework_restore` 一并排除）；今日页、早安简报和世界模型提示词用的都是这一读。

### 计划游标暂存

再次运行或返工清游标时，`take_plan_resumes_for_work_item` 在同一事务里删掉该 Work 的 `kind=execute` 行，并写入 `plan_resumes` 的 `rerun_stash:{work_id}`（`action_id` 为空，行放在 `previous_output_json`）。空的清会先删掉更早的暂存，避免以后把旧游标写回来。`ExecuteRequested` 落库后 `discard_rerun_plan_stash` 删掉暂存。

崩溃窗口：进程死在打开与派发之间时，启动恢复调用 `restore_rerun_plan_stash`。原执行行还在，说明清没有提交，只删暂存、不覆盖。原行已空且暂存还在，才把暂存写回并删键。已经发出 `ExecuteRequested` 的暂存由 `release_finished_rerun_stashes` 丢掉。返工与再次运行共用这一键；收回时的 reason 不同。

### 返工的半开收回

返工把 `completed` 或 `failed` 收成 pending 时用 `reason=rework_restore`，不用 `rerun_restore`。后者只表示简报再次运行的收回，并且总是回到 `completed`。游标仍进同一个 `rerun_stash:{work_id}`。

`ExecuteRequested` 没落库时，同一次请求失败、稍后再次提交（暂存还在），或启动扫描，都把游标放回，并把 Work 收回打开前的 `completed` 或 `failed`，reason 仍是 `rework_restore`。已经发出 `ExecuteRequested` 的返工打开不收回。这次收回不是新的完成，依赖钩子与周期统计都不把它算进去。

任务页读模型：若这次 `changes_requested` 之后已有 `rework_restore`，且该决定之后或这次打开之后没有 `ExecuteRequested`，当前交付的 `review_status` 呈现为 `unreviewed`，`latest_decision` 为 null。决定事件仍在。已经派出的返工仍是 `changes_requested`，交付区仍显示「已要求返工」。

### 死信重放

`replay_dead_letters`（`python -m scripts.replay_dead_letters`）在把死信排成 pending 之前读领域 Work：

- 状态已是 `failed`、`completed` 或 `cancelled`：留下死信，日志 `reason=work_terminal:<status>`，不发 `ExecutionRetried`。用户另行「重新执行」是一条新的 `ExecuteRequested`，不是把旧 handler 行再排成 pending。
- 该死信不是当前尝试：跳过，`not_current_attempt`。当前尝试含「请求 seq 在最新 running 之后」，以及 handler 事后补写的 running 且 `caused_by` 指向该请求。更早一次请求仍跳过。
- 解析出了 work id 但投影行不在：`work_missing`。读状态失败：`work_status_unreadable`。
- 执行并不指向领域 Work（例如 `TimerFired`）：仍可重放。Work 仍为 running 且死信就是当前这次请求时，重放行为不变。

### 单次交付的模型成本

近 N 日 `delivery-metrics` 仍是窗口内各次交付的合计。任务详情每个交付版本另带 `model_cost`，只含该版本 `execution_id` 的两件事：成功且 `caused_by` 指向这次执行的 `LLMCallRecorded` 金额（`llm_cost`），以及同一次执行的恢复次数（`recovery_interventions`：handler replay，加上没有配上的 `interrupted_before_audit`）。其它执行的金额、以及缺少 `caused_by` 的未归因金额，不并入这一对象；未归因仍只出现在窗口汇总的 `unattributed_project_brief_cost`。这一读打满上限时两项都是 `unavailable`，不写成 0。没有 `execution_id` 时为 0。任务页在该版本下写出恢复次数和「模型成本」；`unavailable` 时这一行是「恢复未分开计」或「模型成本未分开计」。窗口合计在任务页另写「窗口模型成本」（`llm_cost` 不可用时是「窗口模型成本未分开计」），两处不是同一个数。响应里的 `items` 列出该窗口有评审或已转任务的简报（`work_id` 与 `title`）；非空 `work_id` 打开 `/tasks/:id`。
