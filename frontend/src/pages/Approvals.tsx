import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

type ResolveFocus = "approve" | "reject";

type FocusAfter = { type: "action"; id: string; which: ResolveFocus } | { type: "refresh" };

/** 绘制前通知。测试在最后一张卸下的同一轮读取焦点。 */
export const approvalPageLayoutFocus = {
  notify: null as null | (() => void),
};

function cardRoot(id: string): HTMLElement | null {
  for (const node of document.querySelectorAll<HTMLElement>("[data-approval-card]")) {
    if (node.getAttribute("data-approval-card") === id) return node;
  }
  return null;
}

/** 焦点在页面空白处、已经卸下的节点，或停在已经禁用的控件上。 */
function focusIsIdle(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!active.isConnected) return true;
  if (active instanceof HTMLButtonElement && active.disabled) return true;
  if (
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
    active.disabled
  ) {
    return true;
  }
  return false;
}

function activeIsAction(id: string, which: ResolveFocus): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.isConnected) return false;
  const card = cardRoot(id);
  if (!card?.contains(active)) return false;
  return active.matches(`button[data-approval-focus="${which}"]`);
}

function focusInCard(id: string, selector: string): boolean {
  const node = cardRoot(id)?.querySelector(selector);
  if (!(node instanceof HTMLElement) || (node instanceof HTMLButtonElement && node.disabled)) {
    return false;
  }
  if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.disabled) {
    return false;
  }
  node.focus();
  return true;
}

function focusAction(id: string, which: ResolveFocus): boolean {
  return focusInCard(id, `button[data-approval-focus="${which}"]`);
}

/** 下一张先落到主按钮。ask_user 还没写回答时主按钮不可用，就落到回答框或取消。 */
function focusNeighbor(id: string): boolean {
  return (
    focusInCard(id, 'button[data-approval-focus="approve"]') ||
    focusInCard(id, "textarea, input") ||
    focusInCard(id, 'button[data-approval-focus="reject"]')
  );
}

function neighborId(items: readonly EnrichedApproval[], id: string): string | null {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  return items[index + 1]?.id ?? items[index - 1]?.id ?? null;
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
  const resolvingRef = useRef(new Map<string, ResolveFocus>());
  const [resolving, setResolving] = useState<Map<string, ResolveFocus>>(() => new Map());
  const refreshLock = useRef(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const focusAfter = useRef<FocusAfter | null>(null);
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

  // 「重试」出现时才拿焦点。放到绘制前，不先停在页面空白。
  // 只在审批页。仪表盘「返回今日」和浮层初始焦点不在这一段里。
  useLayoutEffect(() => {
    if (!shownError) return;
    const root = loadErrorRef.current;
    const button = root?.querySelector("button");
    if (!root || !button || root.contains(document.activeElement)) return;
    button.focus();
  }, [shownError]);

  // 最后一张卸下后才回到「刷新」。放到绘制前，不把焦点留在页面空白。
  // 失败时按钮还在，焦点仍回到刚才那个。已经移到别的控件上就不再抢。
  useLayoutEffect(() => {
    const pending = focusAfter.current;
    if (!pending) return;
    if (pending.type === "action") {
      const held = activeIsAction(pending.id, pending.which);
      const resolvingNow = resolving.has(pending.id);
      if (held) {
        if (!resolvingNow) focusAfter.current = null;
        return;
      }
      if (!focusIsIdle()) {
        focusAfter.current = null;
        return;
      }
      if (resolvingNow) return;
      if (!focusAction(pending.id, pending.which)) return;
      focusAfter.current = null;
      return;
    }
    if (!focusIsIdle()) {
      focusAfter.current = null;
      return;
    }
    const refresh = document.querySelector("[data-approval-refresh]");
    if (!(refresh instanceof HTMLButtonElement) || refresh.disabled) return;
    focusAfter.current = null;
    refresh.focus();
  }, [approvals, resolving, isFetching, refreshBusy]);

  useLayoutEffect(() => {
    approvalPageLayoutFocus.notify?.();
  });

  const beginResolve = (id: string, which: ResolveFocus) => {
    if (resolvingRef.current.has(id)) return false;
    resolvingRef.current.set(id, which);
    setResolving(new Map(resolvingRef.current));
    focusAfter.current = { type: "action", id, which };
    return true;
  };

  const endResolve = (id: string) => {
    resolvingRef.current.delete(id);
    setResolving(new Map(resolvingRef.current));
  };

  const placeFocusAfterRemoval = async (id: string) => {
    const nextId = neighborId(approvals, id);
    const result = await refetch();
    const rows = result.data;
    if (result.isError || !rows || rows.some((row) => row.id === id)) return;
    const pending = focusAfter.current;
    const held =
      pending?.type === "action" && pending.id === id && activeIsAction(id, pending.which);
    if (!focusIsIdle() && !held) {
      focusAfter.current = null;
      return;
    }
    const nextStillThere = nextId != null && rows.some((row) => row.id === nextId);
    if (nextStillThere && nextId && focusNeighbor(nextId)) {
      focusAfter.current = null;
      return;
    }
    focusAfter.current = { type: "refresh" };
  };

  const handleRefresh = () => {
    if (refreshLock.current || loading || isFetching) return;
    refreshLock.current = true;
    setRefreshBusy(true);
    void refetch().finally(() => {
      refreshLock.current = false;
      setRefreshBusy(false);
    });
  };

  const handleApprove = async (item: EnrichedApproval, answer?: string) => {
    if (!beginResolve(item.id, "approve")) return;
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
        if (convId) {
          focusAfter.current = null;
          invalidateApprovals();
          navigate(`/chat/${convId}`);
          return;
        }
        await placeFocusAfterRemoval(item.id);
        return;
      }

      await approveApproval(item.id);
      if (convId) {
        focusAfter.current = null;
        invalidateApprovals();
        navigate(`/chat/${convId}`);
        return;
      }
      await placeFocusAfterRemoval(item.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "审批操作失败";
      addError(msg, "审批");
    } finally {
      endResolve(item.id);
    }
  };

  const handleReject = async (item: EnrichedApproval) => {
    if (!beginResolve(item.id, "reject")) return;
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
      await placeFocusAfterRemoval(item.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "拒绝操作失败";
      addError(msg, "审批");
    } finally {
      endResolve(item.id);
    }
  };

  const refreshing = loading || isFetching || refreshBusy;

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
                data-approval-refresh=""
                aria-busy={refreshBusy || undefined}
                className={refreshBusy ? "opacity-50" : ""}
                onClick={handleRefresh}
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
                busyAction={resolving.get(item.id) ?? null}
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
  busyAction,
  onApprove,
  onReject,
}: {
  item: EnrichedApproval;
  policy?: CapabilityPolicy;
  busyAction: ResolveFocus | null;
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
    <div data-approval-card={item.id}>
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
          data-approval-focus="approve"
          onClick={() => (isAskUser ? onApprove(answer) : onApprove())}
          disabled={isAskUser && !answer && busyAction !== "approve"}
          aria-busy={busyAction === "approve" || undefined}
          className={busyAction === "approve" ? "opacity-50" : ""}
          title={
            isAskUser
              ? "发送回答并继续对话"
              : canContinue
                ? "批准、续写回复并打开对话"
                : "批准此操作"
          }
        >
          {canContinue || isAskUser ? <MessageSquare size={14} /> : <Check size={14} />}
          {isAskUser ? "发送回答" : canContinue ? "批准并续写" : "批准"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-approval-focus="reject"
          onClick={onReject}
          aria-busy={busyAction === "reject" || undefined}
          className={busyAction === "reject" ? "opacity-50" : ""}
          title={isAskUser ? "取消这次澄清" : "拒绝此操作"}
        >
          <X size={14} />
          {isAskUser ? "取消" : "拒绝"}
        </Button>
      </RiskCard>
    </div>
  );
}
