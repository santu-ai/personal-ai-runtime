import { useState, useEffect } from "react";
import type { InboxEmail } from "../../api/client";
import { getInboxEmailSummary } from "../../api/inbox";
import Button from "../ui/Button";
import LoadErrorNotice, { useHeldQueryError } from "../ui/LoadErrorNotice";
import { formatTime } from "../../utils/time";

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  important: { label: "重要", color: "text-danger" },
  actionable: { label: "需跟进", color: "text-warning" },
  ignorable: { label: "可忽略", color: "text-fg-tertiary" },
};

interface Props {
  email: InboxEmail | null;
  onClose: () => void;
}

export default function InboxEmailDetailModal({ email, onClose }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const emailId = email?.id ?? "";
  const [trackedId, setTrackedId] = useState(emailId);
  // 换一封邮件时先丢掉上一封的失败，避免那条原因被记到新邮件上。
  if (emailId !== trackedId) {
    setTrackedId(emailId);
    setSummary(null);
    setSummaryError(null);
    setSummarizing(false);
    setAttempt(0);
  }
  // 重试会把这次错误清掉。原因留着，避免再闪回「AI 正在生成摘要...」。
  const shownSummaryError = useHeldQueryError(
    summary !== null,
    summaryError,
    summarizing,
    "摘要生成失败",
    email?.id ?? "",
  );

  // Auto-generate summary when a new email is opened.
  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    setSummary(null);
    setSummaryError(null);
    setSummarizing(true);
    getInboxEmailSummary(email.id)
      .then((res) => {
        if (cancelled) return;
        setSummary(res.summary || "（无法生成摘要）");
        setSummaryError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSummaryError(err);
      })
      .finally(() => {
        if (!cancelled) setSummarizing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, attempt]);

  if (!email) return null;

  const cat = CATEGORY_LABELS[email.category] || {
    label: email.category,
    color: "text-fg-tertiary",
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-strong rounded-xl max-w-lg w-full shadow-xl flex flex-col max-h-[80vh] outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-block text-xs px-2 py-0.5 rounded bg-surface-overlay ${cat.color}`}
                >
                  {cat.label}
                </span>
                {email.importance > 0 && (
                  <span className="text-xs text-fg-tertiary">
                    重要性 {(email.importance * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold text-fg-primary break-words">{email.subject}</h3>
              <p className="text-sm text-fg-secondary mt-1">{email.sender}</p>
              {email.received_at && (
                <p className="text-xs text-fg-tertiary mt-1">{formatTime(email.received_at)}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-fg-tertiary hover:text-fg-primary text-xl leading-none shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {email.reason && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-fg-tertiary mb-1">分类原因</h4>
              <p className="text-sm text-fg-secondary">{email.reason}</p>
            </div>
          )}
          <div>
            <h4 className="text-xs font-medium text-fg-tertiary mb-2">AI 摘要</h4>
            {shownSummaryError ? (
              <LoadErrorNotice
                message={shownSummaryError}
                busy={summarizing}
                onRetry={() => {
                  if (summarizing) return;
                  setAttempt((value) => value + 1);
                }}
                testId="inbox-summary-load-error"
              />
            ) : summarizing ? (
              <p className="text-sm text-fg-tertiary animate-pulse">AI 正在生成摘要...</p>
            ) : (
              <p className="text-sm text-fg-primary leading-relaxed bg-surface-overlay rounded-lg p-3">
                {summary}
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border-subtle flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
