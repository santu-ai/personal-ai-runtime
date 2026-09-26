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
    const field = screen.getByRole("textbox", { name: "输入消息" });
    expect(field).toHaveAttribute("aria-label", "输入消息");
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

  it("names the disabled action 待你确认 instead of 思考中", () => {
    renderComposer({ value: "你好", disabled: true });
    const waiting = screen.getByRole("button", { name: "待你确认" });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute("title", "先在上面确认或取消，才能继续发送");
    expect(waiting).not.toHaveAttribute("aria-busy");
    const field = screen.getByRole("textbox", { name: "输入消息" });
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute("aria-label", "输入消息");
    expect(field).toHaveAttribute("placeholder", "先在上面确认或取消，暂不能输入消息");
    expect(screen.queryByRole("button", { name: "取消生成" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /思考中/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送" })).not.toBeInTheDocument();
  });

  it("keeps the field enabled while a send is still in flight", () => {
    const onSend = vi.fn();
    renderComposer({ value: "首页这句", pending: true, onSend });
    const field = screen.getByRole("textbox", { name: "输入消息" });
    const send = screen.getByRole("button", { name: "发送中" });
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute("aria-label", "输入消息");
    expect(field).toHaveAttribute("aria-busy", "true");
    expect(field).toHaveAttribute("placeholder", "正在发送…，输入消息仍可改");
    expect(send).toBeEnabled();
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(send).toHaveAttribute("data-chat-send");
    expect(send).toHaveClass("opacity-50");
    field.focus();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^发送$/ })).not.toBeInTheDocument();
  });

  it("does not send while an IME composition or process key is confirming", () => {
    const onSend = vi.fn();
    renderComposer({ value: "还在组字", onSend });
    const field = screen.getByPlaceholderText(/输入消息/);
    field.focus();
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(field, { key: "Process" });
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue("还在组字");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("reads 正在发送 while a send is in flight and leaves focus in the field", () => {
    const inputRef = createRef<HTMLTextAreaElement>();
    const view = render(
      <ChatComposer value="首页这句" onChange={vi.fn()} onSend={vi.fn()} inputRef={inputRef} />,
    );
    const field = screen.getByRole("textbox", { name: "输入消息" });
    field.focus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    view.rerender(
      <ChatComposer
        value="首页这句"
        onChange={vi.fn()}
        onSend={vi.fn()}
        inputRef={inputRef}
        pending
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("正在发送…，输入消息仍可改");
    expect(status).toHaveClass("sr-only");
    expect(field).toHaveAttribute("placeholder", "正在发送…，输入消息仍可改");
    expect(field).toHaveAttribute("aria-label", "输入消息");
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "发送中" })).not.toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads 正在生成 while a reply is generating and clears it when generation ends", () => {
    const inputRef = createRef<HTMLTextAreaElement>();
    const onCancel = vi.fn();
    const view = render(
      <ChatComposer
        value="下一句"
        onChange={vi.fn()}
        onSend={vi.fn()}
        onCancel={onCancel}
        disabled
        inputRef={inputRef}
      />,
    );
    const field = screen.getByRole("textbox", { name: "输入消息" });
    field.focus();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("正在生成，输入消息可以先写下一条");
    expect(status).toHaveClass("sr-only");
    expect(field).toHaveAttribute("placeholder", "正在生成，输入消息可以先写下一条");
    expect(field).toHaveAttribute("aria-label", "输入消息");
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "取消生成" })).not.toHaveFocus();

    view.rerender(
      <ChatComposer value="下一句" onChange={vi.fn()} onSend={vi.fn()} inputRef={inputRef} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveAttribute(
      "aria-label",
      "输入消息",
    );
    expect(field).toHaveFocus();
  });

  it("does not announce the confirmation placeholder or the idle placeholder", () => {
    const { rerender } = renderComposer({ value: "你好", disabled: true });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveAttribute(
      "placeholder",
      "先在上面确认或取消，暂不能输入消息",
    );

    rerender(
      <ChatComposer
        value="你好"
        onChange={vi.fn()}
        onSend={vi.fn()}
        inputRef={createRef<HTMLTextAreaElement>()}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入消息" })).toHaveAttribute(
      "aria-label",
      "输入消息",
    );
  });

  it("reads 正在生成 when sending and generating overlap", () => {
    renderComposer({ value: "下一句", pending: true, disabled: true, onCancel: vi.fn() });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("正在生成，输入消息可以先写下一条");
    expect(
      screen.queryByRole("status", { name: "正在发送…，输入消息仍可改" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the field enabled while generating and does not send again", () => {
    const onCancel = vi.fn();
    const onSend = vi.fn();
    renderComposer({ value: "下一句", disabled: true, onSend, onCancel });
    const field = screen.getByRole("textbox", { name: "输入消息" });
    const cancel = screen.getByRole("button", { name: "取消生成" });
    expect(field).toBeEnabled();
    expect(field).toHaveAttribute("aria-label", "输入消息");
    expect(field).toHaveAttribute("aria-busy", "true");
    expect(field).toHaveAttribute("placeholder", "正在生成，输入消息可以先写下一条");
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
