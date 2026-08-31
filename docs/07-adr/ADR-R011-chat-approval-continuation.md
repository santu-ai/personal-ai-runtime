# ADR-R011 — Chat approval continuation (C2)

| Field | Content |
|-------|---------|
| Decision | 审批后执行已批准工具，并把结果接到同一 `chat_ckpt:{correlation_id}`，恢复原 Chat 工具环。允许再次弹出需确认工具，统一受 `max_tool_iterations`、总超时与 `idem:{corr}:chat:*` 约束。拒绝不调用 LLM，只写入 denied tool result 与一句说明，并清除 checkpoint。无 checkpoint 的旧回合仍走 tools-free 的 `continue_after_tool_result`。Chat 工具环中途崩溃：Scheduler interrupt 重放同一 `ChatRequested` 时从 checkpoint 续跑并恢复 taint；若 status 仍是 `awaiting_approval` 则不调用 LLM。 |
| Context | 产品选择：批准后续写必须能再调工具（连续审批有上限）。核实：`brain_chat_stream` 在 confirmation 时保存 `awaiting_approval`；`approve_handlers` 写入 tool result 后 `resume_after_approved_tool`。 |
| Evidence | `plan_resume.py` (`record_chat_checkpoint`)，`brain_chat_stream.py`，`test_chat_checkpoint.py` |
| Consequences + | 批准后可继续工具环；写类工具仍靠幂等键去重；拒绝路径不变 |
| Consequences − | checkpoint 体积随 messages 增长；`ChatRequested` max_retries=2，第三次崩溃仍 DLQ；审批 HTTP 超时仍受 `submit_command_timeout_approval` 约束 |
| Still valid? | Yes |
