import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import type { RecoverableBriefFailure, UnreviewedDelivery } from "../../api/types";

/** 平时一行。键盘落到这一行时写出整句。鼠标悬停仍是一行。 */
const revealOnFocus =
  "block truncate group-focus-visible:overflow-visible group-focus-visible:whitespace-normal group-focus-visible:text-clip group-focus-visible:break-words";
const focusableRow =
  "group block min-w-0 rounded-sm text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

function taskPath(workId: string): string {
  return `/tasks/${encodeURIComponent(workId)}`;
}

function reviewLine(row: UnreviewedDelivery): string {
  const title = row.title.trim() || "项目简报";
  const version = Number.isFinite(row.version) ? `v${row.version}` : "待验收";
  const summary = row.summary.trim();
  return summary ? `${title} · ${version} · ${summary}` : `${title} · ${version}`;
}

function failureLine(row: RecoverableBriefFailure): string {
  const title = row.title.trim() || "项目简报";
  const error = row.error.trim() || "执行失败";
  return `${title} · ${error}`;
}

interface BriefFollowUpPanelProps {
  unreviewed: UnreviewedDelivery[];
  failures: RecoverableBriefFailure[];
}

export default function BriefFollowUpPanel({ unreviewed, failures }: BriefFollowUpPanelProps) {
  if (unreviewed.length === 0 && failures.length === 0) return null;

  return (
    <section
      aria-label="待验收与失败恢复"
      className="mb-5 rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm"
      data-testid="brief-follow-up"
    >
      {unreviewed.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <ClipboardCheck size={16} className="text-fg-tertiary" />
            <h3 className="text-sm font-semibold tracking-tight text-fg-primary">待验收</h3>
          </div>
          <ul className="space-y-1.5">
            {unreviewed.map((row) => (
              <li key={row.delivery_id || row.work_id} className="text-xs">
                <Link to={taskPath(row.work_id)} className={focusableRow}>
                  <span className={revealOnFocus}>{reviewLine(row)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failures.length > 0 ? (
        <div className={unreviewed.length > 0 ? "mt-4 border-t border-border-subtle pt-3" : ""}>
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle size={16} className="text-danger" />
            <h3 className="text-sm font-semibold tracking-tight text-fg-primary">失败恢复</h3>
          </div>
          <p className="mb-2 text-xs text-fg-tertiary">打开这一份任务后可以重新执行。</p>
          <ul className="space-y-1.5">
            {failures.map((row) => {
              const text = failureLine(row);
              return (
                <li key={row.work_id} className="text-xs">
                  <Link to={taskPath(row.work_id)} className={focusableRow}>
                    <span className={revealOnFocus}>{text}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
