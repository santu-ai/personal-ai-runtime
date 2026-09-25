import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useOverlayDismiss } from "./useOverlayDismiss";

function Panel({
  open,
  onDismiss,
  initialFocus,
  focusKey,
  withField = false,
}: {
  open: boolean;
  onDismiss: () => void;
  initialFocus?: "panel" | "field";
  focusKey?: string | null;
  withField?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const options =
    initialFocus || focusKey !== undefined
      ? {
          ...(initialFocus ? { initialFocus } : {}),
          ...(focusKey !== undefined ? { focusKey } : {}),
        }
      : undefined;
  useOverlayDismiss(open, panelRef, onDismiss, options);
  if (!open) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label="面板" tabIndex={-1}>
      {withField ? <input aria-label="回答" /> : null}
      <button type="button">关闭</button>
    </div>
  );
}

function TrapPanel({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(open, panelRef, onDismiss);
  if (!open) return null;
  return (
    <>
      <button type="button">外面</button>
      <div ref={panelRef} role="dialog" aria-label="面板" tabIndex={-1}>
        <a href="#inside">链到内部</a>
        <button type="button" disabled>
          不可用
        </button>
        <input type="hidden" />
        <button type="button" aria-hidden="true">
          藏起来
        </button>
        <span tabIndex={-1}>标题</span>
        <input aria-label="名称" />
        <button type="button">关闭</button>
      </div>
    </>
  );
}

function EmptyPanel({ open }: { open: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(open, panelRef, () => undefined);
  if (!open) return null;
  return (
    <>
      <button type="button">外面</button>
      <div ref={panelRef} role="dialog" aria-label="空面板" tabIndex={-1}>
        没有控件
      </div>
    </>
  );
}

function BackdropPanel({
  open,
  onDismiss,
  onConfirm,
}: {
  open: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(open, panelRef, onDismiss);
  if (!open) return null;
  return (
    <div role="presentation" onClick={onDismiss}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="面板"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={onConfirm}>
          确认
        </button>
      </div>
    </div>
  );
}

function TimerClose() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  useOverlayDismiss(open, panelRef, () => setOpen(false));
  if (!open) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label="面板" tabIndex={-1}>
      <button type="button" onClick={() => window.setTimeout(() => setOpen(false), 0)}>
        稍后关闭
      </button>
    </div>
  );
}

function RetryAfterOpen() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  const [showRetry, setShowRetry] = useState(false);
  useOverlayDismiss(open, panelRef, () => setOpen(false));
  useEffect(() => {
    setShowRetry(true);
  }, []);
  if (!open) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label="面板" tabIndex={-1}>
      {showRetry ? (
        <button
          type="button"
          ref={(node) => {
            node?.focus();
          }}
        >
          重试
        </button>
      ) : null}
    </div>
  );
}

describe("useOverlayDismiss", () => {
  it("moves focus into the panel and returns it after Escape", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "打开";
    document.body.appendChild(opener);
    opener.focus();
    const onDismiss = vi.fn();
    const view = render(<Panel open onDismiss={onDismiss} />);
    const dialog = screen.getByRole("dialog", { name: "面板" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();

    view.rerender(<Panel open={false} onDismiss={onDismiss} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("uses the latest dismiss callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<Panel open onDismiss={first} />);
    view.rerender(<Panel open onDismiss={second} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("leaves a retry button focused when it appears after open", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "打开";
    document.body.appendChild(opener);
    opener.focus();
    render(<RetryAfterOpen />);
    const retry = await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(retry).toHaveFocus());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("focuses the first field and still returns to the opener", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "编辑";
    document.body.appendChild(opener);
    opener.focus();
    const onDismiss = vi.fn();
    const view = render(<Panel open onDismiss={onDismiss} initialFocus="field" withField />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "回答" })).toHaveFocus());
    view.rerender(<Panel open={false} onDismiss={onDismiss} initialFocus="field" withField />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("returns to the control that opened the next record", async () => {
    const first = document.createElement("button");
    first.type = "button";
    first.textContent = "第一行";
    const second = document.createElement("button");
    second.type = "button";
    second.textContent = "第二行";
    document.body.append(first, second);
    first.focus();
    const onDismiss = vi.fn();
    const view = render(<Panel open onDismiss={onDismiss} focusKey="a" />);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "面板" })).toHaveFocus());
    second.focus();
    view.rerender(<Panel open onDismiss={onDismiss} focusKey="b" />);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "面板" })).toHaveFocus());
    view.rerender(<Panel open={false} onDismiss={onDismiss} focusKey="b" />);
    expect(second).toHaveFocus();
    first.remove();
    second.remove();
  });

  it("keeps the original opener when focus has already fallen away", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "打开";
    document.body.appendChild(opener);
    opener.focus();
    const onDismiss = vi.fn();
    const view = render(<Panel open onDismiss={onDismiss} focusKey="a" />);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "面板" })).toHaveFocus());
    document.body.focus();
    view.rerender(<Panel open onDismiss={onDismiss} focusKey="b" />);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "面板" })).toHaveFocus());
    view.rerender(<Panel open={false} onDismiss={onDismiss} focusKey="b" />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("keeps Tab inside the dialog and skips disabled or hidden controls", async () => {
    const onDismiss = vi.fn();
    render(<TrapPanel open onDismiss={onDismiss} />);
    const dialog = screen.getByRole("dialog", { name: "面板" });
    const outside = screen.getByRole("button", { name: "外面" });
    const link = screen.getByRole("link", { name: "链到内部" });
    const field = screen.getByRole("textbox", { name: "名称" });
    const close = screen.getByRole("button", { name: "关闭" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(link).toHaveFocus();
    fireEvent.keyDown(link, { key: "Tab" });
    expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(link).toHaveFocus();
    expect(outside).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "不可用" })).toBeDisabled();

    fireEvent.keyDown(link, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();

    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(link).toHaveFocus();
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("returns focus in the same turn a timer closes the panel", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "打开";
    document.body.appendChild(opener);
    opener.focus();
    render(<TimerClose />);
    const dialog = screen.getByRole("dialog", { name: "面板" });
    await waitFor(() => expect(dialog).toHaveFocus());

    let focusWhenRemoved: Element | null = null;
    const observer = new MutationObserver(() => {
      if (screen.queryByRole("dialog", { name: "面板" })) return;
      focusWhenRemoved ??= document.activeElement;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    fireEvent.click(screen.getByRole("button", { name: "稍后关闭" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "面板" })).not.toBeInTheDocument(),
    );
    expect(focusWhenRemoved).toBe(opener);
    expect(opener).toHaveFocus();
    observer.disconnect();
    opener.remove();
  });

  it("does not dismiss while an input method is composing", async () => {
    const onDismiss = vi.fn();
    render(<Panel open onDismiss={onDismiss} withField />);
    const field = screen.getByRole("textbox", { name: "回答" });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "面板" })).toHaveFocus());
    field.focus();

    fireEvent.keyDown(field, { key: "Escape", isComposing: true });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "面板" })).toBeInTheDocument();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("ignores the second click of a double-click on the backdrop", () => {
    const onDismiss = vi.fn();
    const onConfirm = vi.fn();
    render(<BackdropPanel open onDismiss={onDismiss} onConfirm={onConfirm} />);
    const backdrop = screen.getByRole("presentation");
    fireEvent.click(backdrop, { detail: 2 });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }), { detail: 2 });
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(backdrop, { detail: 1 });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps Tab on the panel when it has no controls", async () => {
    render(<EmptyPanel open />);
    const dialog = screen.getByRole("dialog", { name: "空面板" });
    const outside = screen.getByRole("button", { name: "外面" });
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toHaveFocus();
    expect(outside).not.toHaveFocus();
  });
});
