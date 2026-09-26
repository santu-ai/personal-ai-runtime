import { useLayoutEffect, useRef, type RefObject } from "react";
import { isImeKeyboardEvent } from "../../utils/imeKey";

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

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function canTabTo(node: HTMLElement): boolean {
  if (node.tabIndex < 0) return false;
  if (node.hasAttribute("disabled")) return false;
  if (node instanceof HTMLInputElement && node.type === "hidden") return false;
  if (node.closest("[hidden], [aria-hidden='true']")) return false;
  return true;
}

/** 对话框里按顺序可以 Tab 到的控件。禁用、隐藏和 tabindex=-1 跳过。 */
function tabbableNodes(panel: HTMLElement): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const items: HTMLElement[] = [];
  for (const node of panel.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
    if (seen.has(node)) continue;
    seen.add(node);
    if (!canTabTo(node)) continue;
    items.push(node);
  }
  return items;
}

function moveTab(panel: HTMLElement, shiftKey: boolean) {
  const items = tabbableNodes(panel);
  if (items.length === 0) {
    if (document.activeElement !== panel) panel.focus();
    return;
  }
  const active = document.activeElement;
  const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const next = shiftKey
    ? index <= 0
      ? items[items.length - 1]
      : items[index - 1]
    : index < 0 || index >= items.length - 1
      ? items[0]
      : items[index + 1];
  if (document.activeElement !== next) next.focus();
}

/**
 * 浮层打开时记住打开前的控件。Esc 关闭。关闭后把焦点还回去。
 * 还焦点发生在布局阶段，和卸下面板同一轮，不先落到页面空白。
 * 换一条记录时，焦点在外面的控件上，也在这一轮进入面板；已经在面板里就不再抢。
 * 焦点掉到页面空白时仍回到原来的控件。
 * 输入法还在组字时按 Esc 不关闭，也不拦住这一下，让输入法自己收掉组字。
 * 面板里已经有焦点（失败「重试」或调用方自己放进去的）时不再抢走。
 * 这一段放在打开时的交焦之后：先进入输入框的，换记录的这一段看到焦点已经在面板里就跳过。
 * Tab 与 Shift+Tab 留在面板里，不会走到后面的页面。
 * 打开按钮上的连点，第二下会落在刚盖上来的遮罩上，这一下不关。单独点外面仍关掉。
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

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    if (isReturnTarget(active, panel)) previouslyFocused.current = active;
    if (panel) focusInside(panel, initialFocus);

    const onKeyDown = (event: KeyboardEvent) => {
      const current = panelRef.current;
      if (event.key === "Tab") {
        if (!current) return;
        event.preventDefault();
        moveTab(current, event.shiftKey);
        return;
      }
      // 组字或输入法处理键时的 Esc 交给输入法。拦住的话，这一下会把对话框关掉。
      if (event.key !== "Escape" || isImeKeyboardEvent(event)) return;
      event.preventDefault();
      onDismissRef.current();
    };
    // 连点的第二下 detail >= 2。它落在遮罩上时不关；面板里的连点照常。
    const onClick = (event: MouseEvent) => {
      if (event.detail < 2) return;
      const current = panelRef.current;
      if (!current) return;
      const target = event.target;
      if (target instanceof Node && current.contains(target)) return;
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick, true);
      const previous = previouslyFocused.current;
      previouslyFocused.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, panelRef, initialFocus]);

  // 换一条记录才进这一段。打开时上面已经交过焦点，这里看到面板里有焦点就跳过，
  // 避免把刚进入的输入框再换成面板。放到绘制前，不先停在外面的按钮或页面空白。
  // 失败「重试」仍在绘制之后才拿焦点，这里不会把它提前抢走。
  useLayoutEffect(() => {
    if (!open || !hasFocusKey) return;
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (panel.contains(active)) return;
    if (isReturnTarget(active, panel)) previouslyFocused.current = active;
    panel.focus();
  }, [open, hasFocusKey, focusKey, panelRef]);
}
