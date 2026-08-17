import { useEffect, useState } from "react";
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
import { useInboxQuery, useInvalidateInbox, RECENT_INBOX_LIMIT } from "../hooks/useInboxQuery";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import NoticeBanner from "../components/ui/NoticeBanner";
import InboxEmailDetailModal from "../components/inbox/InboxEmailDetailModal";

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
          <Button onClick={onRetry} disabled={polling} className="shrink-0">
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
        <p className="text-xs text-warning mt-1">
          同步游标已重建，本次执行了安全刷新
        </p>
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
  const { data, isLoading: loading, error, refetch } = useInboxQuery();
  const invalidateInbox = useInvalidateInbox();
  const emails = data?.emails ?? [];
  const allEmails = data?.allEmails ?? [];
  const digest = data?.digest ?? null;
  const sync = data?.sync ?? null;
  const [polling, setPolling] = useState(false);
  const [initialPollDone, setInitialPollDone] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const addError = useErrorStore((s) => s.addError);
  const quickChat = useQuickChat();

  useEffect(() => {
    if (error) {
      const msg = error instanceof ApiError ? error.message : "加载收件箱失败";
      addError(msg, "收件箱");
    }
  }, [error, addError]);

  // One-shot sync poll on first mount, then rely on query cache.
  useEffect(() => {
    if (initialPollDone) return;
    setInitialPollDone(true);
    void triggerInboxPoll()
      .then(async (res) => {
        if (res && res.status === "error") {
          addError(String(res.error || "轮询邮件失败"), "收件箱");
          return;
        }
        await invalidateInbox();
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : "轮询邮件失败";
        addError(msg, "收件箱");
      });
  }, [initialPollDone, invalidateInbox, addError]);

  const handleAiProcess = async (em: InboxEmail) => {
    try {
      await updateInboxEmailStatus(em.id, "handled");
      invalidateInbox();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "标记处理失败";
      addError(msg, "收件箱");
    }
    const prompt = `请帮我处理这封邮件：\n发件人：${em.sender}\n主题：${em.subject}\n预览：${em.preview}\n分类：${em.category}\n原因：${em.reason}`;
    quickChat({ title: `邮件：${em.subject.slice(0, 20)}`, prompt });
  };

  const handleMarkRead = async (em: InboxEmail) => {
    try {
      await updateInboxEmailStatus(em.id, "read");
      invalidateInbox();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "标记已读失败";
      addError(msg, "收件箱");
    }
  };

  const handleViewDetail = async (em: InboxEmail) => {
    setLoadingDetail(true);
    try {
      const detail = await getInboxEmailDetail(em.id);
      setSelectedEmail(detail);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "加载邮件详情失败";
      addError(msg, "收件箱");
    } finally {
      setLoadingDetail(false);
    }
  };

  const handlePoll = async () => {
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
      setPolling(false);
    }
  };

  const byCategory = (cat: string) => emails.filter((e) => e.category === cat);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-fg-primary">收件箱</h2>
            <p className="text-sm text-fg-tertiary mt-1">未读分拣，以及同步到的全部邮件</p>
          </div>
          <Button onClick={handlePoll} disabled={polling}>
            {polling ? "轮询中..." : "立即轮询"}
          </Button>
        </div>

        <SyncStatusBar sync={sync} polling={polling} onRetry={() => void handlePoll()} />

        {digest && digest.content && (
          <Card className="mb-6">
            <h3 className="text-sm font-medium text-insight mb-2">{digest.title || "今日摘要"}</h3>
            <pre className="text-xs text-fg-secondary whitespace-pre-wrap font-sans">
              {digest.content}
            </pre>
          </Card>
        )}

        {loading && allEmails.length === 0 && emails.length === 0 ? (
          <p className="text-fg-tertiary text-center py-12">加载中...</p>
        ) : (
          <>
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
                          loadingDetail={loadingDetail}
                          onView={() => handleViewDetail(em)}
                          onMarkRead={() => handleMarkRead(em)}
                          onAiProcess={() => handleAiProcess(em)}
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
                      <Card
                        key={em.id}
                        variant="interactive"
                        padding="sm"
                        className={`p-3 ${unread ? "" : "opacity-70"}`}
                        onClick={() => handleViewDetail(em)}
                        aria-label={`${unread ? "未读" : "已读"} ${em.subject || "（无主题）"} ${em.sender}`}
                      >
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span
                            className={`text-sm truncate min-w-0 flex-1 ${
                              unread ? "font-semibold text-fg-primary" : "font-normal text-fg-secondary"
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
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <InboxEmailDetailModal email={selectedEmail} onClose={() => setSelectedEmail(null)} />
    </div>
  );
}

function TriageCard({
  email,
  loadingDetail,
  onView,
  onMarkRead,
  onAiProcess,
}: {
  email: InboxEmail;
  loadingDetail: boolean;
  onView: () => void;
  onMarkRead: () => void;
  onAiProcess: () => void;
}) {
  return (
    <div className="p-3 bg-surface-sunken rounded-lg border border-border-subtle">
      <div className="flex items-baseline gap-2 min-w-0">
        <div className="text-sm font-medium text-fg-primary truncate min-w-0 flex-1">{email.subject}</div>
        <div className="text-xs text-fg-tertiary truncate shrink-0 max-w-[45%]">{email.sender}</div>
      </div>
      <div className="flex gap-3 mt-2">
        <button
          type="button"
          onClick={onView}
          disabled={loadingDetail}
          className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded disabled:opacity-50"
        >
          {loadingDetail ? "加载中..." : "查看"}
        </button>
        <button
          type="button"
          onClick={onMarkRead}
          className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          标记已读
        </button>
        <button
          type="button"
          onClick={onAiProcess}
          className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          让 AI 处理
        </button>
      </div>
    </div>
  );
}
