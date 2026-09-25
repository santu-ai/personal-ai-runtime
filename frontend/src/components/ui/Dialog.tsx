import { useId, useRef, type ReactNode } from "react";
import Button from "./Button";
import { useOverlayDismiss } from "./useOverlayDismiss";

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
