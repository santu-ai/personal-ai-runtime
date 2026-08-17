/**
 * 风险元数据 —— 工具操作的风险分级与展示色调。
 *
 * 风险等级以后端 CapabilityPolicy 为准；前端 RISK_EXPLANATIONS 仅提供文案。
 * 未知 / 未加载策略时默认 medium（假定有风险），避免静默归为 low。
 */

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Info, Shield } from "lucide-react";
import type { CapabilityPolicy } from "../api/settings";

/** 风险等级 */
export type RiskLevel = "high" | "medium" | "low";

/** 已知工具的风险说明（前端文案表） */
export const RISK_EXPLANATIONS: Record<string, string> = {
  write_file: "写入文件是不可逆操作——文件内容会被覆盖。确认前请检查写入路径和内容。",
  apply_patch: "修改文件会改变现有内容。确认前请检查变更预览，尤其是删除的部分。",
  shell_exec: "执行命令可能影响系统状态，且无法撤销。请确认你信任这个命令。",
  send_email: "发送邮件后无法撤回。请确认收件人和内容正确。",
  add_calendar_event: "添加日历日程会写入你的日历。确认前请检查时间是否正确。",
  telegram_send: "发送 Telegram 消息后无法撤回。请确认内容和聊天对象。",
};

/**
 * 根据后端 CapabilityPolicy 判定风险等级。
 * - forbidden / needs_user → high
 * - auto_allow → low
 * - 未注册 / 无策略 → medium
 */
export function getRiskLevelFromPolicy(
  action: string,
  policy?: CapabilityPolicy | null,
): RiskLevel {
  if (!policy) return "medium";
  if (policy.forbidden.includes(action) || policy.needs_user.includes(action)) return "high";
  if (policy.auto_allow.includes(action)) return "low";
  return "medium";
}

/**
 * 根据风险等级获取对应的 Tailwind 色调类名。
 */
export function getRiskTone(level: RiskLevel): {
  container: string;
  icon: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
} {
  switch (level) {
    case "high":
      return {
        container: "bg-danger/15 border border-danger/40",
        icon: "text-danger",
        title: "text-danger/90",
        desc: "text-danger/70",
        Icon: Shield,
      };
    case "medium":
      return {
        container: "bg-warning/15 border border-warning/40",
        icon: "text-warning",
        title: "text-warning/90",
        desc: "text-warning/70",
        Icon: AlertTriangle,
      };
    case "low":
      return {
        container: "bg-surface-raised border border-border-subtle",
        icon: "text-fg-secondary",
        title: "text-fg-primary",
        desc: "text-fg-tertiary",
        Icon: Info,
      };
  }
}
