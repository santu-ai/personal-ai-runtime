import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, RefreshCw } from "lucide-react";
import {
  triggerInboxPoll,
  updateInboxEmailStatus,
  getInboxEmailDetail,
  ApiError,
  type InboxEmail,
  type InboxSyncStatus,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useQuickChat } from "../hooks/useQuickChat";
import {
  useInboxQuery,
  useInvalidateInbox,
  RECENT_INBOX_LIMIT,
  type InboxData,
} from "../hooks/useInboxQuery";
import { queryKeys } from "../hooks/useWsInvalidationBridge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import LoadErrorNotice, {
  queryErrorMessage,
  useHeldQueryError,
} from "../components/ui/LoadErrorNotice";
import NoticeBanner from "../components/ui/NoticeBanner";
import PageHeader from "../components/ui/PageHeader";
import Spinner from "../components/ui/Spinner";
import InboxEmailDetailModal from "../components/inbox/InboxEmailDetailModal";
import InboxDigestModal from "../components/inbox/InboxDigestModal";

const COLUMNS: { key: string; label: string; color: string }[] = [
  { key: "important", label: "重要", color: "text-danger" },
  { key: "actionable", label: "需跟进", color: "text-warning" },
  { key: "ignorable", label: "可忽略", color: "text-fg-tertiary" },
];

const ERROR_KIND_LABEL: Record<string, string> = {
  imap: "IMAP 错误",
  json: "JSON 错误",
  classification: "分类失败",
  credentials: "邮箱未配置",
  other: "同步失败",
};

type TriageAction = "read" | "handled";

type TriageHandoff = {
  id: string;
  nextId: string | null;
  move: boolean;
};

/** 绘制前通知。测试在未读卡片卸下的同一轮读取焦点。 */
export const inboxPageLayoutFocus = {
  notify: null as null | (() => void),
};

/** 焦点在页面空白处，或还停在已经卸掉的按钮上，才安放。已经在别的控件上就不再抢。 */
function focusIsIdle(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

function focusMatching(attr: "inboxMark" | "inboxRecent", id: string): boolean {
  const selector = attr === "inboxMark" ? "[data-inbox-mark]" : "[data-inbox-recent]";
  const nodes = document.querySelectorAll<HTMLElement>(selector);
  for (const node of nodes) {
    if (node.dataset[attr] === id) {
      node.focus();
      return true;
    }
  }
  return false;
}

function placeTriageFocus(handoff: TriageHandoff): void {
  if (handoff.nextId && focusMatching("inboxMark", handoff.nextId)) return;
  if (focusMatching("inboxRecent", handoff.id)) return;
  document.querySelector<HTMLElement>("[data-inbox-poll]")?.focus();
}

function nextPendingInColumn(rows: readonly InboxEmail[], current: InboxEmail): string | null {
  const column = rows.filter((row) => row.category === current.category);
  const index = column.findIndex((row) => row.id === current.id);
  if (index < 0) return null;
  return column[index + 1]?.id ?? column[index - 1]?.id ?? null;
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return "尚未同步";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const delta = Date.now() - t;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(t).toLocaleString();
}

function SyncStatusBar({
  sync,
  polling,
  onRetry,
}: {
  sync: InboxSyncStatus | null;
  polling: boolean;
  onRetry: () => void;
}) {
  if (!sync) return null;
  const failed = sync.status === "error";
  const idle = sync.status === "idle";
  const kindLabel = sync.error_kind ? ERROR_KIND_LABEL[sync.error_kind] || "同步失败" : null;
  const metrics = sync.metrics;
  const tone = failed ? "danger" : idle ? "neutral" : "success";
  const title = idle
    ? "还没有同步记录"
    : failed
      ? `${formatSyncTime(sync.synced_at)} · ${kindLabel || "同步失败"}`
      : `${formatSyncTime(sync.synced_at)} · 同步成功`;
  return (
    <NoticeBanner
      tone={tone}
      testId="inbox-sync-status"
      className="mb-6"
      title={title}
      description={failed && sync.error ? sync.error : undefined}
      action={
        failed ? (
          <Button
            onClick={onRetry}
            aria-busy={polling || undefined}
            className={`shrink-0${polling ? " opacity-50" : ""}`}
          >
            <RefreshCw size={14} className="mr-1 inline" />
            {polling ? "重试中..." : "重试同步"}
          </Button>
        ) : undefined
      }
    >
      {!failed && !idle && (
        <p className="text-xs text-fg-tertiary mt-1">
          新邮件 {sync.new_count} · 已读同步 {sync.synced_read} · 重复 {sync.duplicate_count}
        </p>
      )}
      {sync.cursor_reset && (
        <p className="text-xs text-warning mt-1">同步游标已重建，本次执行了安全刷新</p>
      )}
      {metrics && (
        <p className="text-xs text-fg-disabled mt-1">
          {metrics.days} 日轮询 {metrics.poll_count} 次
          {metrics.rapid_repeat_polls > 0 ? ` · 快速重复 ${metrics.rapid_repeat_polls}` : ""}
          {metrics.duplicate_count > 0 ? ` · 重复邮件 ${metrics.duplicate_count}` : ""}
          {metrics.synced_read > 0 ? ` · 已读同步 ${metrics.synced_read}` : ""}
          {metrics.error_count > 0 ? ` · 失败 ${metrics.error_count}` : ""}
        </p>
      )}
    </NoticeBanner>
  );
}

export default function InboxPage() {
  const { data, isLoading: loading, isFetching, error, refetch } = useInboxQuery();
  const invalidateInbox = useInvalidateInbox();
  const queryClient = useQueryClient();
  const emails = data?.emails ?? [];
  const allEmails = data?.allEmails ?? [];
  const digest = data?.digest ?? null;
  const sync = data?.sync ?? null;
  const hasMail = emails.length > 0 || allEmails.length > 0;
  const shownLoadError = useHeldQueryError(hasMail, error, isFetching, "加载收件箱失败", "inbox");
  const [polling, setPolling] = useState(false);
  const [initialPollDone, setInitialPollDone] = useState(false);
  const pollLock = useRef(false);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const detailRequest = useRef(0);
  const detailInflight = useRef<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<InboxEmail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const detailBusy = Boolean(
    detailTarget && detailLoadingId && detailLoadingId === detailTarget.id,
  );
  // 重试会把这次错误清掉。原因留着，避免列表上的「查看」再闪成「加载中...」。
  const shownDetailError = useHeldQueryError(
    false,
    detailError,
    detailBusy,
    "加载邮件详情失败",
    detailTarget?.id ?? "",
  );
  const addError = useErrorStore((s) => s.addError);
  const quickChat = useQuickChat();
  const triageLocks = useRef(new Set<string>());
  const triageKinds = useRef(new Map<string, TriageAction>());
  const triageHandoffs = useRef(new Map<string, TriageHandoff>());
  const [triageBusy, setTriageBusy] = useState<ReadonlyMap<string, TriageAction>>(() => new Map());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const publishTriage = () => {
    if (!alive.current) return;
    setTriageBusy(new Map(triageKinds.current));
  };

  const startTriage = (id: string, action: TriageAction): boolean => {
    if (triageLocks.current.has(id)) return false;
    triageLocks.current.add(id);
    triageKinds.current.set(id, action);
    publishTriage();
    return true;
  };

  const finishTriage = (id: string) => {
    triageLocks.current.delete(id);
    triageKinds.current.delete(id);
    publishTriage();
  };

  const noteRemoval = (id: string, nextId: string | null) => {
    const snapshot = queryClient.getQueryData<InboxData>(queryKeys.inbox);
    const stillPending = snapshot?.emails.some((row) => row.id === id) ?? true;
    if (stillPending) {
      triageHandoffs.current.delete(id);
      return;
    }
    triageHandoffs.current.set(id, { id, nextId, move: true });
  };

  // 未读卡片卸下后才交焦点。放到绘制前，不把焦点留在页面空白。
  // 已经移到别的控件上就不再抢。
  useLayoutEffect(() => {
    if (triageHandoffs.current.size === 0) return;
    const idle = focusIsIdle();
    let target: TriageHandoff | null = null;
    for (const [id, handoff] of [...triageHandoffs.current]) {
      if (!handoff.move || triageLocks.current.has(id)) continue;
      if (emails.some((row) => row.id === id)) continue;
      triageHandoffs.current.delete(id);
      if (idle) target = handoff;
    }
    if (target) placeTriageFocus(target);
  }, [emails, triageBusy]);

  useLayoutEffect(() => {
    inboxPageLayoutFocus.notify?.();
  });

  useEffect(() => {
    if (error) {
      addError(queryErrorMessage(error, "加载收件箱失败"), "收件箱");
    }
  }, [error, addError]);

  // 打开页面时的同步和两个按钮共用一把锁。回来之前再点不会再发一次。
  const runPoll = useCallback(async () => {
    if (pollLock.current) return;
    pollLock.current = true;
    setPolling(true);
    try {
      const res = await triggerInboxPoll();
      if (res && res.status === "error") {
        addError(String(res.error || "轮询邮件失败"), "收件箱");
        return;
      }
      await refetch();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "轮询邮件失败";
      addError(msg, "收件箱");
    } finally {
      pollLock.current = false;
      setPolling(false);
    }
  }, [addError, refetch]);

  useEffect(() => {
    if (initialPollDone) return;
    setInitialPollDone(true);
    void runPoll();
  }, [initialPollDone, runPoll]);

  const handleAiProcess = async (em: InboxEmail) => {
    if (!startTriage(em.id, "handled")) return;
    const nextId = nextPendingInColumn(emails, em);
    let statusOk = false;
    let opened = false;
    try {
      try {
        await updateInboxEmailStatus(em.id, "handled");
        statusOk = true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "标记处理失败";
        addError(msg, "收件箱");
      }
      const prompt = `请帮我处理这封邮件：\n发件人：${em.sender}\n主题：${em.subject}\n预览：${em.preview}\n分类：${em.category}\n原因：${em.reason}`;
      opened = (await quickChat({ title: `邮件：${em.subject.slice(0, 20)}`, prompt })) === true;
      if (statusOk) {
        try {
          await invalidateInbox();
        } catch {
          // 列表刷新失败仍走查询错误提示，不把已经写下的处理记成失败。
        }
      }
    } finally {
      if (!opened && statusOk) noteRemoval(em.id, nextId);
      finishTriage(em.id);
    }
  };

  const handleMarkRead = async (em: InboxEmail) => {
    if (!startTriage(em.id, "read")) return;
    const nextId = nextPendingInColumn(emails, em);
    let ok = false;
    try {
      await updateInboxEmailStatus(em.id, "read");
      ok = true;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "标记已读失败";
      addError(msg, "收件箱");
    }
    if (ok) {
      try {
        await invalidateInbox();
      } catch {
        // 列表刷新失败仍走查询错误提示。
      }
      noteRemoval(em.id, nextId);
    }
    finishTriage(em.id);
  };

  const handleViewDetail = async (em: InboxEmail) => {
    if (detailInflight.current === em.id) return;
    const requestId = ++detailRequest.current;
    detailInflight.current = em.id;
    setDetailTarget(em);
    setDetailLoadingId(em.id);
    setDetailError(null);
    try {
      const detail = await getInboxEmailDetail(em.id);
      if (detailRequest.current !== requestId) return;
      setSelectedEmail(detail);
      setDetailTarget(null);
      setDetailError(null);
    } catch (err) {
      if (detailRequest.current !== requestId) return;
      const msg = queryErrorMessage(err, "加载邮件详情失败");
      setDetailError(err);
      addError(msg, "收件箱");
    } finally {
      if (detailRequest.current === requestId) {
        setDetailLoadingId(null);
        detailInflight.current = null;
      }
    }
  };

  const byCategory = (cat: string) => emails.filter((e) => e.category === cat);

  return (
    <div className="page-shell">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
        <PageHeader
          title="收件箱"
          description="未读分拣，以及同步到的全部邮件"
          actions={
            <>
              {digest?.content ? (
                <Button variant="secondary" onClick={() => setDigestOpen(true)}>
                  查看摘要
                </Button>
              ) : null}
              <Button
                data-inbox-poll=""
                onClick={() => void runPoll()}
                aria-busy={polling || undefined}
                className={polling ? "opacity-50" : ""}
              >
                {polling ? "轮询中..." : "立即轮询"}
              </Button>
            </>
          }
        />

        <SyncStatusBar sync={sync} polling={polling} onRetry={() => void runPoll()} />

        {shownLoadError ? (
          <LoadErrorNotice
            message={shownLoadError}
            busy={isFetching}
            onRetry={() => void refetch()}
            testId="inbox-load-error"
          />
        ) : loading && !hasMail ? (
          <p className="text-fg-tertiary text-center py-12">加载中...</p>
        ) : (
          <>
            {shownDetailError ? (
              <div className="mb-4">
                <LoadErrorNotice
                  message={shownDetailError}
                  busy={detailBusy}
                  onRetry={() => {
                    if (detailTarget) void handleViewDetail(detailTarget);
                  }}
                  testId="inbox-detail-load-error"
                />
              </div>
            ) : null}
            {emails.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {COLUMNS.map((col) => (
                  <Card key={col.key} padding="sm" className="p-4">
                    <h3 className={`text-sm font-semibold mb-3 ${col.color}`}>
                      {col.label} ({byCategory(col.key).length})
                    </h3>
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto">
                      {byCategory(col.key).map((em) => (
                        <TriageCard
                          key={em.id}
                          email={em}
                          loadingDetail={detailLoadingId === em.id}
                          busyAction={triageBusy.get(em.id) ?? null}
                          onView={() => handleViewDetail(em)}
                          onMarkRead={() => void handleMarkRead(em)}
                          onAiProcess={() => void handleAiProcess(em)}
                        />
                      ))}
                      {byCategory(col.key).length === 0 && (
                        <p className="text-xs text-fg-disabled text-center py-4">暂无</p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-semibold text-fg-primary">最近邮件</h3>
                <span className="text-xs text-fg-tertiary">保留最近 {RECENT_INBOX_LIMIT} 封</span>
              </div>
              {allEmails.length === 0 ? (
                <Card className="py-12 text-center">
                  <Mail size={28} className="mx-auto mb-3 text-fg-disabled" />
                  <p className="text-sm text-fg-secondary">还没有同步到邮件</p>
                  <p className="text-xs text-fg-tertiary mt-1">点右上角「立即轮询」从邮箱拉取</p>
                </Card>
              ) : (
                <div className="space-y-2">
                  {allEmails.map((em) => {
                    const unread = em.status === "pending";
                    return (
                      <button
                        key={em.id}
                        type="button"
                        data-inbox-recent={em.id}
                        onClick={() => void handleViewDetail(em)}
                        aria-busy={detailLoadingId === em.id || undefined}
                        aria-label={`${unread ? "未读" : "已读"} ${em.subject || "（无主题）"} ${em.sender}`}
                        className={`w-full rounded-lg border border-border-subtle bg-surface-raised p-3 text-left shadow-sm transition-colors hover:border-border-strong hover:bg-surface-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                          unread ? "" : "opacity-70"
                        }`}
                      >
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span
                            className={`text-sm truncate min-w-0 flex-1 ${
                              unread
                                ? "font-semibold text-fg-primary"
                                : "font-normal text-fg-secondary"
                            }`}
                          >
                            {em.subject || "（无主题）"}
                          </span>
                          <span
                            className={`text-xs truncate shrink-0 max-w-[45%] ${
                              unread ? "text-fg-secondary" : "text-fg-tertiary"
                            }`}
                          >
                            {em.sender}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <InboxDigestModal
        open={digestOpen && Boolean(digest?.content)}
        title={digest?.title || "今日摘要"}
        content={digest?.content || ""}
        onClose={() => setDigestOpen(false)}
      />
      <InboxEmailDetailModal email={selectedEmail} onClose={() => setSelectedEmail(null)} />
    </div>
  );
}

function TriageCard({
  email,
  loadingDetail,
  busyAction,
  onView,
  onMarkRead,
  onAiProcess,
}: {
  email: InboxEmail;
  loadingDetail: boolean;
  busyAction: TriageAction | null;
  onView: () => void;
  onMarkRead: () => void;
  onAiProcess: () => void;
}) {
  const writing = busyAction !== null;
  const writeClass = `text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded ${
    writing ? "opacity-50" : ""
  }`;
  return (
    <div className="p-3 bg-surface-sunken rounded-lg border border-border-subtle">
      <div className="flex items-baseline gap-2 min-w-0">
        <div className="text-sm font-medium text-fg-primary truncate min-w-0 flex-1">
          {email.subject}
        </div>
        <div className="text-xs text-fg-tertiary truncate shrink-0 max-w-[45%]">{email.sender}</div>
      </div>
      <div className="flex gap-3 mt-2">
        <button
          type="button"
          onClick={onView}
          aria-busy={loadingDetail || undefined}
          className={`inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded${
            loadingDetail ? " opacity-50" : ""
          }`}
        >
          {loadingDetail ? (
            <span aria-hidden="true" className="inline-flex">
              <Spinner size="sm" />
            </span>
          ) : null}
          查看
        </button>
        <button
          type="button"
          data-inbox-mark={email.id}
          aria-busy={busyAction === "read" || undefined}
          onClick={onMarkRead}
          className={writeClass}
        >
          标记已读
        </button>
        <button
          type="button"
          data-inbox-ai={email.id}
          aria-busy={busyAction === "handled" || undefined}
          onClick={onAiProcess}
          className={writeClass}
        >
          让 AI 处理
        </button>
      </div>
    </div>
  );
}
