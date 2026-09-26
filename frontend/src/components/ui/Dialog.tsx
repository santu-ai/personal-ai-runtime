import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Button from "./Button";
import { useOverlayDismiss } from "./useOverlayDismiss";
import { isImeKeyboardEvent } from "../../utils/imeKey";

const SINGLE_LINE_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
]);

/** 单行文字框里的 Enter 才确认。多行、勾选、文件框都不走这一下。 */
function isSingleLineTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && SINGLE_LINE_INPUT_TYPES.has(target.type);
}

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  /** Disable confirm when the form is not ready. Ignored while confirmBusy, so focus stays. */
  confirmDisabled?: boolean;
  /**
   * Confirm is in flight. Confirm and cancel stay enabled so focus is not dropped.
   * A second confirm, cancel, Esc, and the backdrop do not close or send again.
   */
  confirmBusy?: boolean;
  /** Marks the confirm button so the caller can find it after the write returns. */
  confirmMarker?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export default function Dialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "primary",
  confirmDisabled = false,
  confirmBusy = false,
  confirmMarker,
  onConfirm,
  onCancel,
  children,
}: Props) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const dismiss = () => {
    if (confirmBusy) return;
    onCancel();
  };
  useOverlayDismiss(open, panelRef, dismiss);

  const confirmFromEnter = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 组字或输入法处理键时的 Enter 交给输入法。多行框仍换行，勾选仍留给空格。
    if (event.key !== "Enter" || isImeKeyboardEvent(event.nativeEvent)) return;
    if (!isSingleLineTextInput(event.target)) return;
    if (confirmBusy || confirmDisabled) return;
    event.preventDefault();
    onConfirm();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      onClick={dismiss}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="bg-surface-raised border border-border-subtle rounded-xl p-5 max-w-md w-full mx-4 shadow-overlay outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={confirmFromEnter}
      >
        <h3 id={titleId} className="text-base font-semibold tracking-tight text-fg-primary">
          {title}
        </h3>
        {description && (
          <p id={descId} className="text-sm text-fg-secondary mt-2 whitespace-pre-wrap">
            {description}
          </p>
        )}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" size="sm" onClick={dismiss}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === "danger" ? "danger" : "primary"}
            size="sm"
            disabled={confirmDisabled && !confirmBusy}
            aria-busy={confirmBusy || undefined}
            className={confirmBusy ? "opacity-50" : ""}
            data-dialog-confirm={confirmMarker}
            onClick={() => {
              if (confirmBusy) return;
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
