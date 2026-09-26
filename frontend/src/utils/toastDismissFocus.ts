type ToastFocusWhich = "open" | "dismiss";

type ToastFocusHandoff = {
  id: string;
  index: number;
  which: ToastFocusWhich;
};

let handoff: ToastFocusHandoff | null = null;

function focusIsBlank(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

/** 关掉之前记下焦点在哪一条、哪一个按钮上。焦点不在这条里就不记。 */
export function captureToastDismissFocus(id: string): void {
  const roots = [...document.querySelectorAll<HTMLElement>("[data-toast-id]")];
  const index = roots.findIndex((root) => root.getAttribute("data-toast-id") === id);
  const root = index >= 0 ? roots[index] : null;
  const active = document.activeElement;
  if (!root || !(active instanceof Node) || !root.contains(active)) return;
  const which: ToastFocusWhich =
    active instanceof HTMLElement && active.hasAttribute("data-toast-dismiss") ? "dismiss" : "open";
  handoff = { id, index, which };
}

function focusControl(root: HTMLElement, which: ToastFocusWhich): boolean {
  const open = root.querySelector<HTMLElement>("[data-toast-open]");
  const dismiss = root.querySelector<HTMLElement>("[data-toast-dismiss]");
  const target = which === "dismiss" ? (dismiss ?? open) : (open ?? dismiss);
  if (!target) return false;
  target.focus();
  return document.activeElement === target;
}

/**
 * 这一条已经卸下，并且焦点在页面空白处时，落到下一条的同一个按钮。
 * 没有下一条就落到上一条。都没有就落到通知铃。已经在别的控件上就不再抢。
 */
export function placeToastDismissFocus(): void {
  const pending = handoff;
  if (!pending) return;
  const roots = [...document.querySelectorAll<HTMLElement>("[data-toast-id]")];
  if (roots.some((root) => root.getAttribute("data-toast-id") === pending.id)) return;
  handoff = null;
  if (!focusIsBlank()) return;
  const next = roots[pending.index] ?? roots[pending.index - 1];
  if (next && focusControl(next, pending.which)) return;
  document.querySelector<HTMLElement>("[data-notification-bell]")?.focus();
}

export function clearToastDismissFocus(): void {
  handoff = null;
}
