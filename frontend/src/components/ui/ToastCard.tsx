import { X } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_TONE, type StatusTone } from "./statusTone";

interface Props {
  tone?: StatusTone;
  title: ReactNode;
  body?: ReactNode;
  /** 同一栈里用来交焦点。卸下之后还能找到下一条。 */
  toastId?: string;
  onDismiss?: () => void;
  onClick?: () => void;
}

/** Floating notice (live notification or API error). */
export default function ToastCard({
  tone = "neutral",
  title,
  body,
  toastId,
  onDismiss,
  onClick,
}: Props) {
  const t = STATUS_TONE[tone];
  return (
    <div
      className={`border rounded-lg p-3 shadow-lg relative ${t.surface}`}
      data-testid={tone === "danger" ? "error-toast" : "notice-toast"}
      data-toast-id={toastId}
    >
      <div
        className={
          onClick
            ? "cursor-pointer pr-6 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            : "pr-6"
        }
        data-toast-open={onClick ? "" : undefined}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                // 组字时这一下不打开。连按也不再开一次。空格不把页面滚走。
                if (e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (e.repeat) return;
                onClick();
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
          data-toast-dismiss=""
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute top-2 right-2 rounded-md p-0.5 text-fg-tertiary hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
