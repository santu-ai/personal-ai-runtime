# ADR-R017 — Execution trustworthiness (E-1…E-9)

| Field | Content |
|-------|---------|
| Decision | 执行可信化：**零新增事件类型**；复用 `Execution*` payload；步骤幂等/进度用 `plan_resumes` 合成键（`idem:{corr}:{step}` / `progress:{action_id}`）；`ExecutionFailed.dead_letter` + `handler_executions.dead_letter` + `scripts.replay_dead_letters`；lease TTL `running_lease_ttl_seconds` → `Scheduler.reclaim_stale_leases` |
| Context | Lane A 需崩溃恢复、审批后续不可双执行、重试耗尽需可审计 DLQ、僵死 running 需回收；又不想膨胀事件目录 / 概念面 |
| Evidence | `plan_resume.py`（atomic `DELETE … RETURNING`）；`plan_runner.py` step idempotency；`execution_events.emit_execution_failed(..., dead_letter=)`；`agent_scheduler.reclaim_stale_leases` / `requeue_pending`；`execution_repository.replay_dead_letters`；`test_execution_reliability.py` / `test_execution_trustworthiness.py` |
| Consequences + | 不新增 EVENT_*；DLQ 人工重放；lease 在 Scheduler（可 cancel inflight）；Kernel 侧保留薄事件路径 |
| Consequences − | `plan_resumes` 属 APP_STORAGE（不在主权重建代数内）；跨进程 chat 多步续跑仍受 R011 限制 |
| Still valid? | Accepted |

## E-1…E-9 摘要

1. **E-1** 步骤幂等：`idem:{correlation_id}:{step}` 成功结果可跳过重放  
2. **E-2** 进度：`progress:{action_id}` 记录 resume_from  
3. **E-3** DLQ：`dead_letter` 标志 + list/replay  
4. **E-4** Lease：stale running reclaim  
5. **E-5** 进度键与 plan resume 共存于 `plan_resumes`  
6. **E-6** 审批 take-first：原子 `take_plan_resume`  
7. **E-7** Scheduler 非阻塞填槽  
8. **E-8** 背景任务超时 → failed（非挂起）  
9. **E-9** TimerFired emit-first 等控制面顺序约束  

触 Event / 投影面时：**零新增事件类型**，扩展 payload / APP_STORAGE 合成键。
