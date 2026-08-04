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

export default function ConfirmationDialog({ toolCall, onConfirm, onDeny }: Props) {
  const { data: policy } = useCapabilityPolicyQuery();
  const riskLevel = getRiskLevelFromPolicy(toolCall.function_name, policy);

  return (
    <RiskCard
      action={toolCall.function_name}
      args={toolCall.arguments}
      riskLevel={riskLevel}
      policy={policy}
      variant="inline"
    >
      <p className="text-xs text-fg-tertiary w-full mt-1">确认后将执行工具并自动续写一次回复</p>
      <Button size="sm" onClick={onConfirm}>
        确认执行
      </Button>
      <Button size="sm" variant="secondary" onClick={onDeny}>
        取消
      </Button>
    </RiskCard>
  );
}
