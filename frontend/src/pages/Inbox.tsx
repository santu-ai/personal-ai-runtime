import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import {
  triggerInboxPoll,
  updateInboxEmailStatus,
  getInboxEmailDetail,
  ApiError,
  type InboxEmail,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useQuickChat } from "../hooks/useQuickChat";
import { useInboxQuery, useInvalidateInbox } from "../hooks/useInboxQuery";
import { timeAgoShort } from "../utils/timeUtils";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import InboxEmailDetailModal from "../components/inbox/InboxEmailDetailModal";

const COLUMNS: { key: string; label: string; color: string }[] = [
  { key: "important", label: "重要", color: "text-danger" },
  { key: "actionable", label: "待处理", color: "text-warning" },
  { key: "ignorable", label: "可忽略", color: "text-fg-tertiary" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  read: "已读",
  handled: "已处理",
};

function categoryMeta(category: string) {
  return COLUMNS.find((c) => c.key === category) ?? { key: category, label: category, color: "text-fg-tertiary" };
}

export default function InboxPage() {
  const { data, isLoading: loading, error, refetch } = useInboxQuery();
  const invalidateInbox = useInvalidateInbox();
  const emails = data?.emails ?? [];
  const allEmails = data?.allEmails ?? [];
  const digest = data?.digest ?? null;
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

  // One-shot sync poll on first mount (best-effort), then rely on query cache.
  useEffect(() => {
    if (initialPollDone) return;
    setInitialPollDone(true);
    void triggerInboxPoll()
      .then(() => invalidateInbox())
      .catch(() => null);
  }, [initialPollDone, invalidateInbox]);

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
      await triggerInboxPoll();
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
            <p className="text-sm text-fg-tertiary mt-1">待处理分拣，以及同步到的全部邮件</p>
          </div>
          <Button onClick={handlePoll} disabled={polling}>
            {polling ? "轮询中..." : "立即轮询"}
          </Button>
        </div>

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
                <span className="text-xs text-fg-tertiary">{allEmails.length} 封</span>
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
                    const cat = categoryMeta(em.category);
                    const when = em.received_at || em.created_at;
                    return (
                      <Card
                        key={em.id}
                        variant="interactive"
                        padding="sm"
                        className="p-3"
                        onClick={() => handleViewDetail(em)}
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-fg-primary truncate">
                                {em.subject || "（无主题）"}
                              </span>
                              <span className={`text-[11px] shrink-0 ${cat.color}`}>{cat.label}</span>
                              {em.status && em.status !== "pending" && (
                                <span className="text-[11px] text-fg-disabled shrink-0">
                                  {STATUS_LABELS[em.status] ?? em.status}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-fg-tertiary mt-0.5 truncate">{em.sender}</div>
                            {em.preview && (
                              <p className="text-xs text-fg-disabled mt-1 line-clamp-2">{em.preview}</p>
                            )}
                          </div>
                          {when && (
                            <span className="text-xs text-fg-disabled shrink-0" title={when}>
                              {timeAgoShort(when)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-3 mt-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleViewDetail(em)}
                            disabled={loadingDetail}
                            className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded disabled:opacity-50"
                          >
                            {loadingDetail ? "加载中..." : "查看"}
                          </button>
                          {em.status !== "read" && em.status !== "handled" && (
                            <button
                              type="button"
                              onClick={() => handleMarkRead(em)}
                              className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                            >
                              标记已读
                            </button>
                          )}
                          {em.status !== "handled" && (
                            <button
                              type="button"
                              onClick={() => handleAiProcess(em)}
                              className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                            >
                              让 AI 处理
                            </button>
                          )}
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
      <div className="text-sm font-medium text-fg-primary truncate">{email.subject}</div>
      <div className="text-xs text-fg-tertiary mt-1 truncate">{email.sender}</div>
      {email.reason && (
        <div className="text-xs text-fg-disabled mt-2 line-clamp-2">{email.reason}</div>
      )}
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
