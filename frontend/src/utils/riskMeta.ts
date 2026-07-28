/**
 * 风险元数据 —— 工具操作的风险分级、可逆性、影响说明。
 *
 * 约束（Plan 修正 5）：
 * - `reversible`、`impact_summary`、`reason` 必须由后端 Capability 确定性生成。
 * - 前端为空时不编造，显示 "—" 或 "未提供"。
 * - "本次会话信任" 须有服务端约束（前端仅展示，不发裸 trust 标志）。
 */

/** 风险等级 */
export type RiskLevel = "high" | "medium" | "low";

/** 已知工具的风险说明 */
export const RISK_EXPLANATIONS: Record<string, string> = {
  write_file: "写入文件是不可逆操作——文件内容会被覆盖。确认前请检查写入路径和内容。",
  apply_patch: "修改文件会改变现有内容。确认前请检查变更预览，尤其是删除的部分。",
  shell_exec: "执行命令可能影响系统状态，且无法撤销。请确认你信任这个命令。",
  send_email: "发送邮件后无法撤回。请确认收件人和内容正确。",
  add_calendar_event: "添加日历日程会写入你的日历。确认前请检查时间是否正确。",
  telegram_send: "发送 Telegram 消息后无法撤回。请确认内容和聊天对象。",
};

/** 高风险操作（需要红色警示） */
export const HIGH_RISK_OPS = new Set(["shell_exec", "send_email", "telegram_send"]);

/**
 * 判断工具操作的风险等级。
 * - high: shell_exec / send_email / telegram_send
 * - medium: write_file / apply_patch 等已知工具
 * - low: 只读/查询类工具（默认）
 */
export function getRiskLevel(functionName: string): RiskLevel {
  if (HIGH_RISK_OPS.has(functionName)) return "high";
  if (functionName in RISK_EXPLANATIONS) return "medium";
  return "low";
}

/**
 * 根据风险等级获取对应的 Tailwind 色调类名。
 */
export function getRiskTone(level: RiskLevel) {
  switch (level) {
    case "high":
      return {
        container: "bg-danger/15 border border-danger/40",
        icon: "text-danger",
        title: "text-danger/90",
        desc: "text-danger/70",
        iconEmoji: "🔒",
      };
    case "medium":
      return {
        container: "bg-warning/15 border border-warning/40",
        icon: "text-warning",
        title: "text-warning/90",
        desc: "text-warning/70",
        iconEmoji: "⚠️",
      };
    case "low":
      return {
        container: "bg-surface-raised border border-border-subtle",
        icon: "text-fg-secondary",
        title: "text-fg-primary",
        desc: "text-fg-tertiary",
        iconEmoji: "ℹ️",
      };
  }
}

/**
 * 判断工具操作的可逆性（后端未提供时的保守默认值）。
 * 注意：这是前端在没有后端 `reversible` 字段时的保守估计。
 * 一旦后端提供 `reversible`，应直接使用后端值。
 */
export function guessReversible(functionName: string): boolean {
  // 只读/查询类工具都是可逆的
  const readOnly = new Set([
    "get_current_time",
    "read_file",
    "list_directory",
    "search_files",
    "web_search",
    "fetch_url",
    "list_calendar_events",
    "get_upcoming_events",
    "check_inbox",
    "read_inbox_email",
    "get_clipboard",
    "ocr_image",
    "git_status",
    "git_log",
    "git_diff",
  ]);
  return readOnly.has(functionName);
}
