import { X } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "./statusTone";

interface Props {
  tone?: StatusTone;
  title: ReactNode;
  body?: ReactNode;
  onDismiss?: () => void;
  onClick?: () => void;
}

/** Floating notice (live notification or API error). */
export default function ToastCard({ tone = "neutral", title, body, onDismiss, onClick }: Props) {
  const t = STATUS_TONE[tone];
  return (
    <div
      className={`border rounded-lg p-3 shadow-lg relative ${t.surface}`}
      data-testid={tone === "danger" ? "error-toast" : "notice-toast"}
    >
      <div
        className={onClick ? "cursor-pointer pr-6" : "pr-6"}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") onClick();
              }
            : undefined
        }
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        <div className={`text-sm font-medium ${t.title}`}>{title}</div>
        {body && <div className={`text-xs ${t.body} mt-1 line-clamp-2`}>{body}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute top-2 right-2 text-fg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
