import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import type { ExecutionTrust, ExecutionTrustItem } from "../../api/types";
import { timeAgoShort } from "../../utils/timeUtils";
import { STATUS_TONE } from "../ui/statusTone";

function countOf(byStatus: Record<string, number>, status: string): number {
  return byStatus[status] ?? 0;
}

function rowLabel(item: {
  handler_name: string;
  event_type: string;
  error: string | null;
}): string {
  const name = item.handler_name || item.event_type || "未知执行";
  return item.error ? `${name} · ${item.error}` : name;
}

function taskPath(workId: string | null | undefined): string | null {
  const id = workId?.trim();
  if (!id) return null;
  return `/tasks/${encodeURIComponent(id)}`;
}

function retryLabel(item: ExecutionTrustItem): string {
  const name = item.handler_name || item.event_type;
  const attempt = item.retry_count > 0 ? ` · 第 ${item.retry_count} 次` : "";
  const error = item.error?.trim();
  return error ? `重试中 ${name}${attempt} · ${error}` : `重试中 ${name}${attempt}`;
}

/** 与最近失败同一条执行（相同 id）不再出现在死信列表。correlation_id 不参与去重。 */
function deadLettersBesideLastFailure(trust: ExecutionTrust): ExecutionTrustItem[] {
  const failedId = trust.last_failed?.id.trim() ?? "";
  const rows = failedId
    ? trust.dead_letter.filter((item) => item.id !== failedId)
    : trust.dead_letter;
  return rows.slice(0, 3);
}

/**
 * 最近失败之外的失败行。跳过已作为最近失败展示的 id，以及死信列表中的 id
 * （含未画进前三条的死信），避免同一条执行出现两次。correlation_id 不参与去重。
 * `failed` 本身已按最新在前截断。
 */
function otherFailedRows(trust: ExecutionTrust): ExecutionTrustItem[] {
  const hidden = new Set<string>();
  const lastId = trust.last_failed?.id.trim() ?? "";
  if (lastId) hidden.add(lastId);
  for (const item of trust.dead_letter) {
    const id = item.id.trim();
    if (id) hidden.add(id);
  }
  return trust.failed.filter((item) => !hidden.has(item.id.trim()));
}

function TrustText({
  item,
  text,
  link,
}: {
  item: ExecutionTrustItem;
  text: string;
  link: boolean;
}) {
  const href = link ? taskPath(item.work_id) : null;
  const title = item.error || (href ? "打开任务" : undefined);
  if (!href) {
    return (
      <span className="min-w-0 truncate" title={title}>
        {text}
      </span>
    );
  }
  return (
    <Link
      to={href}
      className="min-w-0 rounded-sm text-inherit hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      title={title}
    >
      <span className="block truncate">{text}</span>
    </Link>
  );
}

interface Props {
  trust: ExecutionTrust;
}

export default function ExecutionTrustPanel({ trust }: Props) {
  const failedCount = countOf(trust.by_status, "failed");
  const inRetryCount = countOf(trust.by_status, "in_retry");
  const deadCount = trust.dead_letter_count;
  const hasIssue = failedCount > 0 || inRetryCount > 0 || deadCount > 0;

  const surface = hasIssue ? STATUS_TONE.danger.surface : STATUS_TONE.neutral.surface;
  return (
    <section
      className={`mb-6 rounded-xl border px-4 py-3 ${surface}`}
      data-testid="execution-trust"
    >
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert size={16} className={hasIssue ? "text-danger" : "text-fg-tertiary"} />
        <h3 className="text-sm font-semibold text-fg-primary">执行</h3>
        <span className="ml-auto text-xs text-fg-tertiary">
          待审批 {trust.pending_approvals} · 失败 {countOf(trust.by_status, "failed")} · 重试{" "}
          {countOf(trust.by_status, "in_retry")} · 死信 {deadCount}
        </span>
      </div>

      {trust.last_completed && (
        <p className="text-xs text-fg-secondary flex items-center gap-1.5">
          <CheckCircle2 size={12} className="text-success shrink-0" />
          最近完成 {trust.last_completed.handler_name || trust.last_completed.event_type}
          {trust.last_completed.completed_at
            ? ` · ${timeAgoShort(trust.last_completed.completed_at)}`
            : ""}
        </p>
      )}

      {trust.last_failed && (
        <p className="text-xs text-danger mt-1 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <TrustText item={trust.last_failed} text={rowLabel(trust.last_failed)} link />
        </p>
      )}

      {otherFailedRows(trust).map((item) => (
        <p key={`failed-${item.id}`} className="text-xs text-danger mt-1 flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <TrustText item={item} text={rowLabel(item)} link />
        </p>
      ))}

      {trust.in_retry.slice(0, 3).map((item) => (
        <p key={item.id} className="text-xs text-warning mt-1 flex items-center gap-1.5">
          <RotateCcw size={12} className="shrink-0" />
          <TrustText item={item} text={retryLabel(item)} link />
        </p>
      ))}

      {deadLettersBesideLastFailure(trust).map((item) => (
        <p key={item.id} className="text-xs text-fg-secondary mt-1 flex items-center gap-1.5">
          <TrustText item={item} text={`死信 ${rowLabel(item)}`} link />
        </p>
      ))}

      {!hasIssue && !trust.last_completed && (
        <p className="text-xs text-fg-tertiary">最近没有失败或重试中的后台执行。</p>
      )}
    </section>
  );
}
