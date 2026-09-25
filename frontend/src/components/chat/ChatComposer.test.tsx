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
  it("keeps the timeline focus ring on the field", () => {
    renderComposer();
    const field = screen.getByPlaceholderText(/输入消息/);
    expect(field).toHaveClass("focus-visible:ring-2", "focus-visible:ring-focus-ring");
    expect(field.className.split(/\s+/)).not.toContain("outline-none");
  });

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
    expect(screen.getByPlaceholderText(/输入消息/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
  });

  it("keeps the field enabled while a send is still in flight", () => {
    const onSend = vi.fn();
    renderComposer({ value: "首页这句", pending: true, onSend });
    const field = screen.getByPlaceholderText(/输入消息/);
    const send = screen.getByRole("button", { name: "发送" });
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute("aria-busy", "true");
    expect(send).toBeEnabled();
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(send).toHaveAttribute("data-chat-send");
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps the field enabled while generating and does not send again", () => {
    const onCancel = vi.fn();
    const onSend = vi.fn();
    renderComposer({ value: "下一句", disabled: true, onSend, onCancel });
    const field = screen.getByPlaceholderText(/输入消息/);
    const cancel = screen.getByRole("button", { name: "取消生成" });
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute("aria-busy", "true");
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveAttribute("aria-busy", "true");
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});
