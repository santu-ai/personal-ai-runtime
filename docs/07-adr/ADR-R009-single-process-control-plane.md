# ADR-R009 — Single-process control plane

| Field | Content |
|-------|---------|
| Decision | Scheduler / RuntimeLoop / cancel flags 运行在 FastAPI 同进程；**不**实现分布式 lease 或多 worker |
| Context | 个人本地 Runtime；多实例会要求租约与共享队列，超出产品约束 |
| Evidence | `agent_scheduler.py`, `runtime_loop.py`, `main.py` lifespan；`check_single_process_control_plane.py`；启动时单实例文件锁 `{sqlite_path}.lock`（`store/database.py` InstanceLock，第二实例拒绝启动） |
| Consequences + | 恢复与反压模型简单；CI 防误扩 |
| Consequences − | 无水平扩展 |
| Still valid? | Yes（Non-goal until product becomes multi-instance service） |
