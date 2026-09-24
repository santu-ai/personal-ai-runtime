import { useEffect, useRef, useState } from "react";
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
import PageHeader from "../components/ui/PageHeader";
import Spinner from "../components/ui/Spinner";
import { TextArea } from "../components/ui/Input";
import RiskCard from "../components/approval/RiskCard";
import { canContinueApproval } from "./approvals/canContinue";
import type { CapabilityPolicy } from "../api/settings";

/** 非空 task_id 打开任务页。空白不编造链接，也不使用 correlation_id。 */
function taskPageHref(taskId: string | null | undefined): string | undefined {
  const id = taskId?.trim();
  if (!id) return undefined;
  return `/tasks/${encodeURIComponent(id)}`;
}

/** 接口错误用原文。其它失败用页面自己的说法，避免把空队列写成已经处理完。 */
function approvalLoadError(error: unknown): string {
  if (error instanceof ApiError && error.message.trim()) return error.message.trim();
  return "加载审批列表失败";
}

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
  const loadErrorRef = useRef<HTMLDivElement>(null);
  // 首次失败时缓存里没有列表。重试一开始会把查询错误清掉，这里留住原因，按钮才不会被「加载中」换掉。
  const [heldError, setHeldError] = useState<string | null>(null);
  const shownError =
    approvals.length > 0 ? null : error ? approvalLoadError(error) : isFetching ? heldError : null;

  useEffect(() => {
    if (approvals.length > 0 || (!error && !isFetching)) {
      setHeldError(null);
      return;
    }
    if (error) setHeldError(approvalLoadError(error));
  }, [approvals.length, error, isFetching]);

  useEffect(() => {
    if (error) {
      addError(approvalLoadError(error), "审批");
    }
  }, [error, addError]);

  useEffect(() => {
    if (!shownError) return;
    const root = loadErrorRef.current;
    const button = root?.querySelector("button");
    if (!root || !button || root.contains(document.activeElement)) return;
    button.focus();
  }, [shownError]);

  const handleApprove = async (item: EnrichedApproval, answer?: string) => {
    setResolving((prev) => new Set(prev).add(item.id));
    try {
      const convId = item.conversation_id || "";
      const toolCallId = item.tool_call_id || "";
      const canContinue = canContinueApproval(item);
      const isAskUser = item.action === "ask_user";

      if (canContinue || isAskUser) {
        // 对话来源走 chat resolve，触发同一工具环续写。ask_user 必须带文本回答。
        const args = parseParams(item.params) || {};
        const res = answer
          ? await resolveApproval(
              item.id,
              "approve",
              item.action || "",
              args,
              convId,
              toolCallId,
              answer,
            )
          : await resolveApproval(item.id, "approve", item.action || "", args, convId, toolCallId);
        if (res.status === "resume_failed" || res.retryable) {
          addError(res.error || "续写失败，可再试一次", "审批");
          return;
        }
        invalidateApprovals();
        if (convId) navigate(`/chat/${convId}`);
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

  const handleReject = async (item: EnrichedApproval) => {
    setResolving((prev) => new Set(prev).add(item.id));
    try {
      if (canContinueApproval(item) || item.action === "ask_user") {
        const args = parseParams(item.params) || {};
        await resolveApproval(
          item.id,
          "deny",
          item.action || "",
          args,
          item.conversation_id || "",
          item.tool_call_id || "",
        );
      } else {
        await rejectApproval(item.id, "手动拒绝");
      }
      invalidateApprovals();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "拒绝操作失败";
      addError(msg, "审批");
    } finally {
      setResolving((prev) => {
        const n = new Set(prev);
        n.delete(item.id);
        return n;
      });
    }
  };

  const refreshing = loading || isFetching;

  return (
    <div className="page-shell">
      <div className="page-container">
        <PageHeader
          title="审批管理"
          description="管理所有需要人工确认的高风险操作"
          actions={
            <>
              {approvals.length > 0 && <Badge tone="warning">{approvals.length} 条待处理</Badge>}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refetch()}
                disabled={refreshing}
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                刷新
              </Button>
            </>
          }
        />
        <p className="-mt-3 mb-5 text-xs text-fg-disabled">
          对话来源的审批可「批准并续写」：执行工具并生成一次回复后打开对话。
        </p>

        {loading && approvals.length === 0 && !shownError ? (
          <div className="flex items-center justify-center py-20 text-fg-tertiary">
            <RefreshCw size={20} className="animate-spin mr-2" />
            加载中…
          </div>
        ) : shownError ? (
          <div
            ref={loadErrorRef}
            className="space-y-2 rounded-xl border border-danger/30 p-4"
            data-testid="approvals-load-error"
            role="alert"
          >
            <p className="text-sm text-danger">{shownError}</p>
            <Button
              size="sm"
              variant="secondary"
              aria-busy={isFetching || undefined}
              onClick={() => {
                if (isFetching) return;
                void refetch();
              }}
            >
              {isFetching ? (
                <span aria-hidden="true" className="inline-flex">
                  <Spinner size="sm" />
                </span>
              ) : null}
              重试
            </Button>
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
                onApprove={(answer) => handleApprove(item, answer)}
                onReject={() => handleReject(item)}
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
  onApprove: (answer?: string) => void;
  onReject: () => void;
}) {
  const isExpiringSoon = item.expires_at
    ? new Date(item.expires_at).getTime() - Date.now() < 3600000
    : false;
  const canContinue = canContinueApproval(item);
  const isAskUser = item.action === "ask_user";
  const [draft, setDraft] = useState("");
  const answer = draft.trim();
  const question = (() => {
    const params = parseParams(item.params);
    const raw = params?.question;
    return typeof raw === "string" ? raw : "";
  })();

  return (
    <RiskCard
      action={item.action || ""}
      args={item.params ?? "{}"}
      variant="panel"
      policy={policy}
      riskLevel={isAskUser ? "low" : undefined}
      title={isAskUser ? "需要你补充一点信息" : undefined}
      source={{
        flowLabel: item.flow_label || item.flow_type,
        proposedBy: item.proposed_by ?? undefined,
        conversationId: item.conversation_id ?? undefined,
        taskHref: taskPageHref(item.task_id),
      }}
      timing={{
        createdAt: item.created_at ?? undefined,
        expiresAt: item.expires_at ?? undefined,
      }}
      expiringSoon={isExpiringSoon}
    >
      {isAskUser && (
        <div className="w-full basis-full space-y-2">
          <p className="text-sm text-fg-primary whitespace-pre-wrap">
            {question || "助手需要你的回答才能继续。"}
          </p>
          <TextArea
            aria-label="你的回答"
            className="w-full"
            maxLength={8000}
            value={draft}
            placeholder="输入回答，助手会带着它继续"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      )}
      <Button
        size="sm"
        onClick={() => (isAskUser ? onApprove(answer) : onApprove())}
        disabled={resolving || (isAskUser && !answer)}
        title={
          isAskUser ? "发送回答并继续对话" : canContinue ? "批准、续写回复并打开对话" : "批准此操作"
        }
      >
        {canContinue || isAskUser ? <MessageSquare size={14} /> : <Check size={14} />}
        {isAskUser ? "发送回答" : canContinue ? "批准并续写" : "批准"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onReject}
        disabled={resolving}
        title={isAskUser ? "取消这次澄清" : "拒绝此操作"}
      >
        <X size={14} />
        {isAskUser ? "取消" : "拒绝"}
      </Button>
    </RiskCard>
  );
}
