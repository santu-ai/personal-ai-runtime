import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert } from "lucide-react";
import type { ExecutionTrust } from "../../api/types";
import { timeAgoShort } from "../../utils/timeUtils";
import { STATUS_TONE } from "../ui/statusTone";

function countOf(byStatus: Record<string, number>, status: string): number {
  return byStatus[status] ?? 0;
}

function rowLabel(item: { handler_name: string; event_type: string; error: string | null }): string {
  const name = item.handler_name || item.event_type || "未知执行";
  return item.error ? `${name} · ${item.error}` : name;
}

interface Props {
  trust: ExecutionTrust;
}

export default function ExecutionTrustPanel({ trust }: Props) {
  const failedCount = countOf(trust.by_status, "failed");
  const retryingCount = countOf(trust.by_status, "retrying");
  const deadCount = trust.dead_letter_count;
  const hasIssue = failedCount > 0 || retryingCount > 0 || deadCount > 0;

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
          {countOf(trust.by_status, "retrying")} · 死信 {deadCount}
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
        <p className="text-xs text-danger mt-1 flex items-start gap-1.5" title={trust.last_failed.error || ""}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 truncate">{rowLabel(trust.last_failed)}</span>
        </p>
      )}

      {trust.retrying.slice(0, 3).map((item) => (
        <p key={item.id} className="text-xs text-warning mt-1 flex items-center gap-1.5">
          <RotateCcw size={12} className="shrink-0" />
          重试中 {item.handler_name || item.event_type}
          {item.retry_count > 0 ? ` · 第 ${item.retry_count} 次` : ""}
        </p>
      ))}

      {trust.dead_letter.slice(0, 3).map((item) => (
        <p key={item.id} className="text-xs text-fg-secondary mt-1 truncate" title={item.error || ""}>
          死信 {rowLabel(item)}
        </p>
      ))}

      {!hasIssue && !trust.last_completed && (
        <p className="text-xs text-fg-tertiary">最近没有失败或重试中的后台执行。</p>
      )}
    </section>
  );
}
