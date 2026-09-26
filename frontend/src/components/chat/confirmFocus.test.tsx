import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useConfirmFocusContainment } from "./confirmFocus";

function Harness({
  active = true,
  detailsOpen = false,
  withDialog = false,
}: {
  active?: boolean;
  detailsOpen?: boolean;
  withDialog?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(active);
  useConfirmFocusContainment(on, panelRef);
  return (
    <>
      <button type="button" onClick={() => setOn(false)}>
        关掉
      </button>
      <button type="button">外面</button>
      <button type="button" data-confirm-exit="">
        离开
      </button>
      {withDialog ? (
        <div role="dialog" aria-label="别的对话框">
          <button type="button">对话框里</button>
        </div>
      ) : null}
      {on ? (
        <div ref={panelRef} role="group" aria-label="待确认" tabIndex={-1}>
          <details open={detailsOpen}>
            <summary>查看详细参数</summary>
            <button type="button">藏起来的</button>
          </details>
          <button type="button" disabled>
            不可用
          </button>
          <textarea aria-label="你的回答" />
          <button type="button">确认</button>
          <button type="button">取消</button>
        </div>
      ) : null}
    </>
  );
}

describe("useConfirmFocusContainment", () => {
  it("cycles Tab inside the card and skips disabled or closed details", () => {
    render(<Harness />);
    const summary = screen.getByText("查看详细参数");
    const answer = screen.getByRole("textbox", { name: "你的回答" });
    const confirm = screen.getByRole("button", { name: "确认" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const outside = screen.getByRole("button", { name: "外面" });
    confirm.focus();

    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(summary).toHaveFocus();
    fireEvent.keyDown(summary, { key: "Tab" });
    expect(answer).toHaveFocus();
    fireEvent.keyDown(answer, { key: "Tab" });
    expect(confirm).toHaveFocus();
    expect(outside).not.toHaveFocus();
    expect(screen.getByRole("button", { name: "藏起来的" })).not.toHaveFocus();

    fireEvent.keyDown(confirm, { key: "Tab", shiftKey: true });
    expect(answer).toHaveFocus();
    summary.focus();
    fireEvent.keyDown(summary, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("includes a control once its details are open", () => {
    render(<Harness detailsOpen />);
    const summary = screen.getByText("查看详细参数");
    const hidden = screen.getByRole("button", { name: "藏起来的" });
    summary.focus();
    fireEvent.keyDown(summary, { key: "Tab" });
    expect(hidden).toHaveFocus();
  });

  it("does not pull Tab back from another control", () => {
    render(<Harness />);
    const outside = screen.getByRole("button", { name: "外面" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(outside).toHaveFocus();
    fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
    expect(outside).toHaveFocus();
  });

  it("returns Tab to the card when focus has fallen away and no dialog is open", () => {
    render(<Harness />);
    const summary = screen.getByText("查看详细参数");
    const cancel = screen.getByRole("button", { name: "取消" });
    screen.getByRole("button", { name: "确认" }).focus();
    (document.activeElement as HTMLElement).blur();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(summary).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it("leaves the card on Escape without resolving, and ignores Escape while composing", () => {
    render(<Harness />);
    const answer = screen.getByRole("textbox", { name: "你的回答" });
    const exit = screen.getByRole("button", { name: "离开" });
    const outside = screen.getByRole("button", { name: "外面" });
    answer.focus();
    fireEvent.keyDown(answer, { key: "Escape", isComposing: true });
    fireEvent.keyDown(answer, { key: "Escape", keyCode: 229 });
    expect(answer).toHaveFocus();

    fireEvent.keyDown(answer, { key: "Escape" });
    expect(exit).toHaveFocus();
    expect(screen.getByRole("group", { name: "待确认" })).toBeInTheDocument();

    fireEvent.keyDown(exit, { key: "Escape" });
    expect(exit).toHaveFocus();
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(outside).toHaveFocus();
  });

  it("stops containing Tab after the card closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "关掉" }));
    const outside = screen.getByRole("button", { name: "外面" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(outside).toHaveFocus();
    expect(screen.queryByRole("group", { name: "待确认" })).not.toBeInTheDocument();
  });

  it("does not pull a blank focus into the card while another dialog is open", () => {
    render(<Harness withDialog />);
    const insideDialog = screen.getByRole("button", { name: "对话框里" });
    insideDialog.focus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByText("查看详细参数")).not.toHaveFocus();

    screen.getByRole("button", { name: "确认" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
  });
});
