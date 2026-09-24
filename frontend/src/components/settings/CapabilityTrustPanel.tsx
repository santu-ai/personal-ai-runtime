import { useEffect } from "react";
import { useErrorStore } from "../../stores/errorStore";
import { useCapabilityPolicyQuery } from "../../hooks/useSettingsQuery";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";
import { toolLabel } from "../../utils/toolLabels";

function ToolChipList({
  tools,
  tone,
}: {
  tools: string[];
  tone: "success" | "warning" | "danger";
}) {
  const styles = {
    success: "bg-success/10 text-success/80 border-success/20",
    warning: "bg-warning/10 text-warning/80 border-warning/20",
    danger: "bg-danger/10 text-danger/80 border-danger/20",
  }[tone];
  if (tools.length === 0) {
    return <p className="text-xs text-fg-disabled">（无）</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((id) => (
        <span key={id} className={`text-xs px-2 py-1 rounded border ${styles}`} title={id}>
          {toolLabel(id)}
        </span>
      ))}
    </div>
  );
}

export default function CapabilityTrustPanel() {
  const { data, isFetching, error, refetch } = useCapabilityPolicyQuery();
  const shownError = useHeldQueryError(
    Boolean(data),
    error,
    isFetching,
    "加载能力策略失败",
    "capability-policy",
  );
  const addError = useErrorStore((s) => s.addError);

  useEffect(() => {
    if (error) {
      addError(queryErrorMessage(error, "加载能力策略失败"), "设置");
    }
  }, [error, addError]);

  if (shownError) {
    return (
      <LoadErrorNotice
        message={shownError}
        busy={isFetching}
        onRetry={() => void refetch()}
        testId="capability-policy-load-error"
      />
    );
  }
  if (!data) {
    return <p className="text-xs text-fg-disabled">加载策略中…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="text-xs font-medium text-success">自动执行</span>
          <span className="text-xs text-fg-tertiary">— 安全操作，无需确认</span>
        </div>
        <ToolChipList tools={data.auto_allow} tone="success" />
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-warning" />
          <span className="text-xs font-medium text-warning">需要确认</span>
          <span className="text-xs text-fg-tertiary">— 写操作 / 外发，可在对话内信任</span>
        </div>
        <ToolChipList tools={data.needs_user} tone="warning" />
      </div>
      {data.external_ingestion.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-warning" />
            <span className="text-xs font-medium text-warning">外部内容摄入</span>
            <span className="text-xs text-fg-tertiary">— 会污染上下文链，后续写操作需确认</span>
          </div>
          <ToolChipList tools={data.external_ingestion} tone="warning" />
        </div>
      )}
      {data.forbidden.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-danger" />
            <span className="text-xs font-medium text-danger">禁止</span>
            <span className="text-xs text-fg-tertiary">— 策略硬拦截</span>
          </div>
          <ToolChipList tools={data.forbidden} tone="danger" />
        </div>
      )}
    </div>
  );
}
