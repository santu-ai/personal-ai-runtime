# ADR-R011 — Chat approval continuation (C2)

| Field | Content |
|-------|---------|
| Decision | 审批后执行已批准工具 + `Brain.continue_after_tool_result`（无 tools 的 one-shot）。Chat 工具环中途崩溃：把 messages/iteration/taint/tool_calls 写入 `plan_resumes` 键 `chat_ckpt:{correlation_id}`，Scheduler interrupt 重放同一 `ChatRequested` 时从 checkpoint 续跑并恢复 taint。审批续写路径仍不重开 tools。 |
| Context | 产品选择：最小 Chat checkpoint（C1）。核实：`brain_chat_stream` persist/load；`approve_handlers` → `continue_after_tool_result` 仍无 tools |
| Evidence | `plan_resume.py` (`record_chat_checkpoint`)，`brain_chat_stream.py`，`test_chat_checkpoint.py` |
| Consequences + | 工具环中断后可续跑；写类工具仍靠 `idem:{corr}:chat:*` 去重 |
| Consequences − | checkpoint 体积随 messages 增长；`ChatRequested` max_retries=2，第三次崩溃仍 DLQ |
| Still valid? | Partial（审批 one-shot 仍成立；工具环跨进程续跑已落地） |
