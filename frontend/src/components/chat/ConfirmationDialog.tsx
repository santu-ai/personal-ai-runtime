import Button from "../ui/Button";
import RiskCard from "../approval/RiskCard";
import { useCapabilityPolicyQuery } from "../../hooks/useSettingsQuery";
import { getRiskLevelFromPolicy } from "../../utils/riskMeta";
import type { ToolCall } from "./types";

interface Props {
  toolCall: ToolCall;
  onConfirm: () => void;
  onDeny: () => void;
}

/** Tools that are framed as proactive suggestions rather than raw side-effects. */
const SUGGESTION_TOOLS: Record<string, { title: string; hint: string; confirm: string }> = {
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
};

export default function ConfirmationDialog({ toolCall, onConfirm, onDeny }: Props) {
  const { data: policy } = useCapabilityPolicyQuery();
  const riskLevel = getRiskLevelFromPolicy(toolCall.function_name, policy);
  const suggestion = SUGGESTION_TOOLS[toolCall.function_name];

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
