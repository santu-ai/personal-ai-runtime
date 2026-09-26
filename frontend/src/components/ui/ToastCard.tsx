import { X } from "lucide-react";
import type { ReactNode } from "react";
import { isImeKeyboardEvent } from "../../utils/imeKey";
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

/** 错误和警告打断当前这一句；通知等说完再读。 */
function announceRole(tone: StatusTone): "alert" | "status" {
  return tone === "danger" || tone === "warning" ? "alert" : "status";
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
    // 出现时读出来。不把焦点抢过来。
    <div
      className={`group border rounded-lg p-3 shadow-lg relative ${t.surface}`}
      data-testid={tone === "danger" ? "error-toast" : "notice-toast"}
      data-toast-id={toastId}
      role={announceRole(tone)}
      aria-atomic="true"
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
                // 组字或输入法处理键时这一下不打开。连按也不再开一次。空格不把页面滚走。
                if (isImeKeyboardEvent(e.nativeEvent)) return;
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
        {/* 正文平时最多两行。键盘落到「关闭」或可以点开的那一块时写出整段。鼠标悬停仍是两行。 */}
        {body && (
          <div
            className={`text-xs ${t.body} mt-1 line-clamp-2 group-has-[:focus-visible]:line-clamp-none group-has-[:focus-visible]:break-words`}
          >
            {body}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          data-toast-dismiss=""
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="group absolute top-2 right-2 inline-flex max-w-full items-center justify-center rounded-md p-0.5 text-fg-tertiary hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="关闭"
        >
          <X size={14} aria-hidden className="shrink-0 group-focus-visible:hidden" />
          <span
            data-icon-name=""
            className="hidden whitespace-nowrap text-center text-[10px] leading-tight group-focus-visible:block"
          >
            关闭
          </span>
        </button>
      )}
    </div>
  );
}
