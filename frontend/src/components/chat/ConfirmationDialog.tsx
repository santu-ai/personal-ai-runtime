import { useState } from "react";
import { getRiskLevel } from "../../utils/riskMeta";
import Button from "../ui/Button";
import RiskCard from "../approval/RiskCard";

interface ToolCall {
  index: number;
  id: string;
  function_name: string;
  arguments: string;
}

interface Props {
  toolCall: ToolCall;
  onConfirm: (trustSession?: boolean) => void;
  onDeny: () => void;
}

export default function ConfirmationDialog({ toolCall, onConfirm, onDeny }: Props) {
  const [trustSession, setTrustSession] = useState(false);
  const riskLevel = getRiskLevel(toolCall.function_name);
  const isHighRisk = riskLevel === "high";

  return (
    <RiskCard
      action={toolCall.function_name}
      args={toolCall.arguments}
      riskLevel={riskLevel}
      variant="inline"
      trustSlot={
        /* 信任选项 —— 中风险才显示（高风险每次都要确认） */
        !isHighRisk ? (
          <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={trustSession}
              onChange={(e) => setTrustSession(e.target.checked)}
              disabled
              className="rounded"
            />
            本次对话内自动允许（待后端支持）
          </label>
        ) : undefined
      }
    >
      {/* Chat 专属指引：解释审批后的续写行为 */}
      <p className="text-xs text-fg-tertiary w-full">
        确认后将执行工具并自动续写一次回复；完整多步工具循环不会在服务重启后自动恢复，必要时请新开一轮对话。
      </p>
      <Button size="sm" onClick={() => onConfirm(trustSession)}>
        确认执行
      </Button>
      <Button size="sm" variant="secondary" onClick={onDeny}>
        取消
      </Button>
    </RiskCard>
  );
}
