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
});
