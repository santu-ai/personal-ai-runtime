import { useEffect, useRef, type RefObject } from "react";

type InitialFocus = "panel" | "field";

interface OverlayDismissOptions {
  /** panel：焦点进对话框。field：进第一个可用输入框，没有则进对话框。 */
  initialFocus?: InitialFocus;
  /**
   * 同一浮层换一条记录时传入。焦点在浮层外的控件上（例如另一行的按钮）
   * 才更新返回目标；焦点掉到 body 上时仍回到原来的控件。
   */
  focusKey?: string | null;
}

function isReturnTarget(node: Element | null, panel: HTMLElement | null): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    node !== document.body &&
    node !== document.documentElement &&
    !panel?.contains(node)
  );
}

function focusInside(panel: HTMLElement, initialFocus: InitialFocus) {
  const active = document.activeElement;
  if (active instanceof Node && panel.contains(active)) return;
  if (initialFocus === "field") {
    const field = panel.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    if (field) {
      field.focus();
      return;
    }
  }
  panel.focus();
}

/**
 * 浮层打开时记住打开前的控件。Esc 关闭。关闭后把焦点还回去。
 * 面板里已经有焦点（失败「重试」或调用方自己放进去的）时不再抢走。
 */
export function useOverlayDismiss<T extends HTMLElement>(
  open: boolean,
  panelRef: RefObject<T | null>,
  onDismiss: () => void,
  options?: OverlayDismissOptions,
): void {
  const initialFocus = options?.initialFocus ?? "panel";
  const hasFocusKey = options != null && "focusKey" in options;
  const focusKey = options?.focusKey ?? null;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    if (isReturnTarget(active, panel)) previouslyFocused.current = active;
    if (panel) focusInside(panel, initialFocus);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismissRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const previous = previouslyFocused.current;
      previouslyFocused.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, panelRef, initialFocus]);

  useEffect(() => {
    if (!open || !hasFocusKey) return;
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (panel.contains(active)) return;
    if (isReturnTarget(active, panel)) previouslyFocused.current = active;
    panel.focus();
  }, [open, hasFocusKey, focusKey, panelRef]);
}
