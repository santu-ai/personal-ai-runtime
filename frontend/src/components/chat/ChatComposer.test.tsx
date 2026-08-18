import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ChatComposer from "./ChatComposer";

function renderComposer(props: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  const inputRef = createRef<HTMLTextAreaElement>();
  return render(
    <ChatComposer value="" onChange={vi.fn()} onSend={vi.fn()} inputRef={inputRef} {...props} />,
  );
}

describe("ChatComposer", () => {
  it("disables send when the input is empty", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("enables send when the input has text", () => {
    const onSend = vi.fn();
    renderComposer({ value: "你好", onSend });
    const send = screen.getByRole("button", { name: "发送" });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled thinking state without onCancel", () => {
    renderComposer({ value: "你好", disabled: true });
    const thinking = screen.getByRole("button", { name: /思考中/ });
    expect(thinking).toBeDisabled();
    expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
  });

  it("shows an enabled cancel button while generating", () => {
    const onCancel = vi.fn();
    const onSend = vi.fn();
    renderComposer({ value: "", disabled: true, onSend, onCancel });
    const cancel = screen.getByRole("button", { name: "取消生成" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
