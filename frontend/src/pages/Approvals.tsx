import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, X, RefreshCw, MessageSquare } from "lucide-react";
import {
  approveApproval,
  rejectApproval,
  resolveApproval,
  ApiError,
  type EnrichedApproval,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useApprovalsQuery, useInvalidateApprovals } from "../hooks/useApprovalsQuery";
import { useCapabilityPolicyQuery } from "../hooks/useSettingsQuery";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Card from "../components/ui/Card";
import RiskCard from "../components/approval/RiskCard";
import { canContinueApproval } from "./approvals/canContinue";
import type { CapabilityPolicy } from "../api/settings";

function parseParams(params?: string): Record<string, unknown> | null {
  try {
    if (!params) return null;
    return JSON.parse(params);
  } catch {
    return { raw: params };
  }
}

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const {
    data: approvals = [],
    isLoading: loading,
    error,
    refetch,
    isFetching,
  } = useApprovalsQuery();
  const { data: policy } = useCapabilityPolicyQuery();
  const invalidateApprovals = useInvalidateApprovals();
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const addError = useErrorStore((s) => s.addError);

  useEffect(() => {
    if (error) {
      const msg = error instanceof ApiError ? error.message : "加载审批列表失败";
      addError(msg, "审批");
    }
  }, [error, addError]);

  const handleApprove = async (item: EnrichedApproval) => {
    setResolving((prev) => new Set(prev).add(item.id));
    try {
      const convId = item.conversation_id || "";
      const toolCallId = item.tool_call_id || "";
      const canContinue = canContinueApproval(item);

      if (canContinue) {
        // P3: 对话来源 — 走 chat resolve，触发 one-shot 续写后跳转对话
        const args = parseParams(item.params) || {};
        await resolveApproval(item.id, "approve", item.action || "", args, convId, toolCallId);
        invalidateApprovals();
        navigate(`/chat/${convId}`);
        return;
      }

      await approveApproval(item.id);
      invalidateApprovals();
      if (convId) {
        navigate(`/chat/${convId}`);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "审批操作失败";
      addError(msg, "审批");
    } finally {
      setResolving((prev) => {
        const n = new Set(prev);
        n.delete(item.id);
        return n;
      });
    }
  };

  const handleReject = async (id: string) => {
    setResolving((prev) => new Set(prev).add(id));
    try {
      await rejectApproval(id, "手动拒绝");
      invalidateApprovals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "拒绝操作失败";
      addError(msg, "审批");
    } finally {
      setResolving((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const refreshing = loading || isFetching;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-fg-primary">审批管理</h2>
            <p className="text-sm text-fg-tertiary mt-1">管理所有需要人工确认的高风险操作</p>
            <p className="text-xs text-fg-disabled mt-1">
              对话来源的审批可「批准并续写」：执行工具并生成一次回复后打开对话。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {approvals.length > 0 && <Badge tone="warning">{approvals.length} 条待处理</Badge>}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refetch()}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={`inline mr-1 ${refreshing ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        </div>

        {loading && approvals.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-fg-tertiary">
            <RefreshCw size={20} className="animate-spin mr-2" />
            加载中...
          </div>
        ) : approvals.length === 0 ? (
          <Card className="py-16 text-center">
            <div className="text-fg-tertiary mb-2">
              <Check size={40} className="mx-auto mb-3 text-success" />
              <p className="text-lg font-medium text-fg-secondary">暂无待审批项</p>
              <p className="text-sm text-fg-disabled mt-1">所有高风险操作已处理完毕</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {approvals.map((item) => (
              <ApprovalCard
                key={item.id}
                item={item}
                policy={policy}
                resolving={resolving.has(item.id)}
                onApprove={() => handleApprove(item)}
                onReject={() => handleReject(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  item,
  policy,
  resolving,
  onApprove,
  onReject,
}: {
  item: EnrichedApproval;
  policy?: CapabilityPolicy;
  resolving: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isExpiringSoon = item.expires_at
    ? new Date(item.expires_at).getTime() - Date.now() < 3600000
    : false;
  const canContinue = canContinueApproval(item);

  return (
    <RiskCard
      action={item.action || ""}
      args={item.params ?? "{}"}
      variant="panel"
      policy={policy}
      source={{
        flowLabel: item.flow_label || item.flow_type,
        proposedBy: item.proposed_by ?? undefined,
        conversationId: item.conversation_id ?? undefined,
      }}
      timing={{
        createdAt: item.created_at ?? undefined,
        expiresAt: item.expires_at ?? undefined,
      }}
      expiringSoon={isExpiringSoon}
    >
      <button
        onClick={onApprove}
        disabled={resolving}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-overlay hover:bg-border-strong text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        title={canContinue ? "批准、续写回复并打开对话" : "批准此操作"}
      >
        {canContinue ? <MessageSquare size={14} /> : <Check size={14} />}
        {canContinue ? "批准并续写" : "批准"}
      </button>
      <button
        onClick={onReject}
        disabled={resolving}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-transparent hover:bg-surface-overlay text-fg-secondary border border-border-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        title="拒绝此操作"
      >
        <X size={14} />
        拒绝
      </button>
    </RiskCard>
  );
}
