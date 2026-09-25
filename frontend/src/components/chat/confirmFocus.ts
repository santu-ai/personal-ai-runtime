import { useEffect, type RefObject } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const CONFIRM_EXIT = "[data-confirm-exit]";

function hiddenInClosedDetails(node: HTMLElement): boolean {
  let ancestor = node.parentElement;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = ancestor.querySelector(":scope > summary");
      if (summary !== node) return true;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

function canTabTo(node: HTMLElement): boolean {
  if (node.closest("[hidden], [aria-hidden='true']")) return false;
  if (hiddenInClosedDetails(node)) return false;
  if (node.hasAttribute("disabled")) return false;
  if (node instanceof HTMLInputElement && node.type === "hidden") return false;
  if (node.tagName === "SUMMARY") return node.getAttribute("tabindex") !== "-1";
  return node.tabIndex >= 0;
}

/** 卡片里按顺序可以 Tab 到的控件。禁用、隐藏和收起的详情跳过。 */
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

function focusIsBlank(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

function focusIsInside(panel: HTMLElement): boolean {
  const active = document.activeElement;
  return active instanceof Node && panel.contains(active);
}

function foreignDialogOpen(panel: HTMLElement): boolean {
  for (const dialog of document.querySelectorAll<HTMLElement>("[role='dialog']")) {
    if (!panel.contains(dialog)) return true;
  }
  return false;
}

function shouldContainTab(panel: HTMLElement): boolean {
  if (focusIsInside(panel)) return true;
  if (!focusIsBlank()) return false;
  return !foreignDialogOpen(panel);
}

function focusConfirmExit() {
  const exit = document.querySelector<HTMLElement>(CONFIRM_EXIT);
  if (exit && document.activeElement !== exit) exit.focus();
}

/**
 * 待确认卡片不是对话框。焦点在卡片里时，Tab 与 Shift+Tab 留在卡片里。
 * 焦点已经在别的控件上时不拉回来。焦点掉到页面空白处、且没有别的对话框时，Tab 回到卡片。
 * Esc 离开卡片，不确认也不取消。
 */
export function useConfirmFocusContainment<T extends HTMLElement>(
  active: boolean,
  panelRef: RefObject<T | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || event.defaultPrevented) return;
      if (event.key === "Tab") {
        if (!shouldContainTab(panel)) return;
        event.preventDefault();
        moveTab(panel, event.shiftKey);
        return;
      }
      if (event.key !== "Escape" || event.isComposing) return;
      if (!focusIsInside(panel)) return;
      event.preventDefault();
      focusConfirmExit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, panelRef]);
}
