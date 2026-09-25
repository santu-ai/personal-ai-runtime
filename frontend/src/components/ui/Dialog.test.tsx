import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Dialog from "./Dialog";

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Dialog open={false} title="删除" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes dialog a11y attributes when open", () => {
    render(
      <Dialog
        open
        title="删除对话"
        description="此操作不可撤销"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("删除对话");
    expect(dialog).toHaveAccessibleDescription("此操作不可撤销");
  });

  it("calls onCancel when Escape is pressed", () => {
    const onCancel = vi.fn();
    render(<Dialog open title="删除" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("Escape uses the latest onCancel after rerender", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Dialog open title="删除" onConfirm={vi.fn()} onCancel={first} />);
    rerender(<Dialog open title="删除" onConfirm={vi.fn()} onCancel={second} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("calls onCancel when backdrop is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <Dialog open title="删除" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    // Outer presentation layer is the backdrop
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("marks confirm busy and ignores a second click", () => {
    const onConfirm = vi.fn();
    render(
      <Dialog
        open
        title="忘掉"
        confirmLabel="忘掉中..."
        confirmBusy
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "忘掉中..." });
    btn.focus();
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(btn).toHaveFocus();
  });

  it("ignores Escape, backdrop, and cancel while confirm is busy", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <Dialog
        open
        title="忘掉"
        confirmLabel="忘掉中..."
        confirmBusy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(container.firstChild as HTMLElement);
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole("button", { name: "忘掉中..." }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps Tab on cancel and confirm", async () => {
    render(
      <>
        <button type="button">外面</button>
        <Dialog open title="删除" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>,
    );
    const dialog = screen.getByRole("dialog");
    const outside = screen.getByRole("button", { name: "外面" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认" });
    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    expect(outside).not.toHaveFocus();
  });

  it("skips a disabled confirm and still cycles the busy confirm", async () => {
    const { rerender } = render(
      <Dialog open title="删除" confirmDisabled onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const cancel = screen.getByRole("button", { name: "取消" });
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(cancel).toHaveFocus();
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    rerender(
      <Dialog
        open
        title="删除"
        confirmLabel="删除中..."
        confirmBusy
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const busy = screen.getByRole("button", { name: "删除中..." });
    expect(busy).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("button", { name: "取消" }), { key: "Tab" });
    expect(busy).toHaveFocus();
    fireEvent.keyDown(busy, { key: "Tab" });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
  });

  it("disables confirm when confirmDisabled is set", () => {
    const onConfirm = vi.fn();
    render(<Dialog open title="删除" confirmDisabled onConfirm={onConfirm} onCancel={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "确认" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
