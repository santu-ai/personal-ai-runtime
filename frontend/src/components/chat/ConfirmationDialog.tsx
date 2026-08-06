import Button from "../ui/Button";
import RiskCard from "../approval/RiskCard";
import { useCapabilityPolicyQuery } from "../../hooks/useSettingsQuery";
import { getRiskLevelFromPolicy } from "../../utils/riskMeta";
import { toolLabel } from "../../utils/toolLabels";
import type { ToolCall } from "./types";

interface Props {
  toolCall: ToolCall;
  onConfirm: () => void;
  onDeny: () => void;
}

interface SuggestionCopy {
  title: string;
  hint: string;
  confirm: string;
}

/** capability_policy.json ``needs_user`` + proactive ``set_timer`` (auto_allow). */
const SUGGESTION_TOOLS = new Set([
  "set_timer",
  "apply_patch",
  "write_file",
  "add_calendar_event",
  "send_email",
  "shell_exec",
  "telegram_send",
  "computer_screenshot",
  "computer_click",
  "computer_type",
  "computer_move",
  "computer_scroll",
  "computer_key",
  "create_goal",
  "update_goal_progress",
  "complete_goal",
  "delete_goal",
]);

/** Prefer specific copy; fall back to toolLabel-based framing. */
const SUGGESTION_OVERRIDES: Record<string, SuggestionCopy> = {
  set_timer: {
    title: "建议：创建定时提醒",
    hint: "确认后将创建定时器，并自动续写一次回复。",
    confirm: "确认创建",
  },
  create_goal: {
    title: "建议：创建目标",
    hint: "确认后将创建目标，并自动续写一次回复。",
    confirm: "确认创建",
  },
  update_goal_progress: {
    title: "建议：更新目标进度",
    hint: "确认后将更新目标进度，并自动续写一次回复。",
    confirm: "确认更新",
  },
  complete_goal: {
    title: "建议：完成目标",
    hint: "确认后将标记目标完成，并自动续写一次回复。",
    confirm: "确认完成",
  },
  delete_goal: {
    title: "建议：删除目标",
    hint: "确认后将删除目标，并自动续写一次回复。",
    confirm: "确认删除",
  },
  send_email: {
    title: "建议：发送邮件",
    hint: "确认后将发送邮件，并自动续写一次回复。",
    confirm: "确认发送",
  },
  add_calendar_event: {
    title: "建议：添加日历日程",
    hint: "确认后将写入日历，并自动续写一次回复。",
    confirm: "确认添加",
  },
  write_file: {
    title: "建议：写入文件",
    hint: "确认后将写入文件，并自动续写一次回复。",
    confirm: "确认写入",
  },
  apply_patch: {
    title: "建议：修改文件",
    hint: "确认后将应用补丁，并自动续写一次回复。",
    confirm: "确认修改",
  },
  shell_exec: {
    title: "建议：执行命令",
    hint: "确认后将在本机执行命令，并自动续写一次回复。",
    confirm: "确认执行",
  },
  telegram_send: {
    title: "建议：发送 Telegram 消息",
    hint: "确认后将发送消息，并自动续写一次回复。",
    confirm: "确认发送",
  },
};

function suggestionFor(name: string): SuggestionCopy | undefined {
  if (!SUGGESTION_TOOLS.has(name)) return undefined;
  const override = SUGGESTION_OVERRIDES[name];
  if (override) return override;
  const label = toolLabel(name);
  return {
    title: `建议：${label}`,
    hint: "确认后将执行该操作，并自动续写一次回复。",
    confirm: "确认执行",
  };
}

export default function ConfirmationDialog({ toolCall, onConfirm, onDeny }: Props) {
  const { data: policy } = useCapabilityPolicyQuery();
  const riskLevel = getRiskLevelFromPolicy(toolCall.function_name, policy);
  const suggestion = suggestionFor(toolCall.function_name);

  return (
    <RiskCard
      action={toolCall.function_name}
      args={toolCall.arguments}
      riskLevel={riskLevel}
      policy={policy}
      variant="inline"
      title={suggestion?.title}
    >
      <p className="text-xs text-fg-tertiary w-full mt-1">
        {suggestion?.hint ?? "确认后将执行工具并自动续写一次回复"}
      </p>
      <Button size="sm" onClick={onConfirm}>
        {suggestion?.confirm ?? "确认执行"}
      </Button>
      <Button size="sm" variant="secondary" onClick={onDeny}>
        取消
      </Button>
    </RiskCard>
  );
}
