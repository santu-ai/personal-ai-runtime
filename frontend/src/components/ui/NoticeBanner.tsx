import type { ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "./statusTone";

interface Props {
  tone?: StatusTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}

/** Page-level status strip (auth, backend down, inbox sync, execution). */
export default function NoticeBanner({
  tone = "neutral",
  title,
  description,
  action,
  children,
  className = "",
  testId,
}: Props) {
  const t = STATUS_TONE[tone];
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${t.surface} ${className}`.trim()}
      data-testid={testId}
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm ${t.title}`}>{title}</p>
          {description && <p className={`text-xs ${t.body} mt-1`}>{description}</p>}
          {children}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}
