/**
 * 后台执行和定时栏共用的名字。认识的写成中文，不认识的仍是原来的字。
 * 空白不当成一个名字。
 */
const HANDLER_LABELS: Record<string, string> = {
  morning_brief: "早安简报",
  deadline_alert: "截止提醒",
  memory_decay: "记忆衰减",
  world_model_snapshot: "世界模型快照",
  projection_snapshots: "投影快照",
  inbox_poll: "收件箱拉取",
  inbox_digest: "收件箱摘要",
  url_monitor: "网页监控",
  telegram_poll: "Telegram 轮询",
  reminder: "提醒",
  on_execute_requested: "执行任务",
  handle_execute: "执行任务",
  on_timer_fired: "定时触发",
  on_chat_requested: "对话",
  on_chat_completed_record_turn: "记下这一轮",
  on_chat_completed_extract_memories: "提取记忆",
  on_chat_completed_telegram_reply: "Telegram 回复",
  on_approve_completed_telegram_reply: "Telegram 审批回复",
  on_inbox_poll_requested: "收件箱拉取",
  on_approve_requested: "审批",
};

/** 和任务行同一套状态字。调度上的重试中也写在这里。不认识的仍是原来的字。 */
const EXECUTION_STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "运行中",
  blocked: "阻塞",
  waiting_approval: "待审批",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  retrying: "重试中",
  in_retry: "重试中",
};

export function handlerLabel(name: string | null | undefined): string {
  const key = (name ?? "").trim();
  if (!key) return "";
  return HANDLER_LABELS[key] ?? key;
}

export function executionStatusLabel(status: string | null | undefined): string {
  const key = (status ?? "").trim();
  if (!key) return "";
  return EXECUTION_STATUS_LABELS[key] ?? key;
}
