import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import ConfirmationDialog from "./ConfirmationDialog";
import { renderWithRouter } from "../../test-utils";

const policyQuery = {
  data: {
    auto_allow: ["read_file"],
    needs_user: ["write_file", "apply_patch", "send_email", "computer_click"],
    forbidden: ["shell_exec"],
    external_ingestion: [],
  },
  isPending: false,
  isLoading: false,
  error: null as Error | null,
};

vi.mock("../../hooks/useSettingsQuery", () => ({
  useCapabilityPolicyQuery: () => policyQuery,
}));

afterEach(() => {
  policyQuery.isPending = false;
  cleanup();
});

const toolCall = {
  index: 0,
  id: "tc-1",
  function_name: "write_file",
  arguments: JSON.stringify({ path: "/tmp/test.txt", content: "hello" }),
};

describe("ConfirmationDialog", () => {
  it("renders suggestion framing and expandable arguments for write_file", () => {
    renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={vi.fn()} onDeny={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "建议：写入文件" })).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("建议：写入文件。高风险。");
    expect(status).toHaveClass("sr-only");
    expect(status).not.toHaveFocus();
    expect(screen.getByText(/确认后将写入文件/)).toBeInTheDocument();
    const summary = screen.getByText("查看详细参数");
    fireEvent.click(summary);
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });

  it("waits for the capability policy before reading a tool card once", () => {
    policyQuery.isPending = true;
    const view = renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={vi.fn()} onDeny={vi.fn()} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "建议：写入文件" })).toBeInTheDocument();

    policyQuery.isPending = false;
    view.rerender(<ConfirmationDialog toolCall={toolCall} onConfirm={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("建议：写入文件。高风险。");
  });

  it("keeps the same announcement while busy and reads the next card again", () => {
    const view = renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={vi.fn()} onDeny={vi.fn()} />,
    );
    const status = screen.getByRole("status");
    view.rerender(
      <ConfirmationDialog
        toolCall={toolCall}
        busyAction="confirm"
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("建议：写入文件。高风险。");

    view.rerender(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-next",
          function_name: "apply_patch",
          arguments: JSON.stringify({ path: "/tmp/a.md" }),
        }}
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );
    const next = screen.getByRole("status");
    expect(next).not.toBe(status);
    expect(next).toHaveTextContent("建议：修改文件。高风险。/tmp/a.md。");
    expect(next).not.toHaveFocus();
  });

  it("calls onConfirm when user approves", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();

    const { container } = renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={onConfirm} onDeny={onDeny} />,
    );

    const confirmBtn = within(container).getByRole("button", { name: "确认写入" });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("sends a free-text answer for ask_user and ignores an empty draft", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();
    const { container } = renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-ask",
          function_name: "ask_user",
          arguments: JSON.stringify({
            question: "简报要覆盖最近几天？",
            context: "没有天数就无法筛选邮件",
          }),
        }}
        onConfirm={onConfirm}
        onDeny={onDeny}
      />,
    );

    expect(screen.getAllByText("简报要覆盖最近几天？").length).toBeGreaterThan(0);
    expect(screen.getByText("没有天数就无法筛选邮件")).toBeInTheDocument();
    const send = within(container).getByRole("button", { name: "发送回答" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("你的回答"), { target: { value: "  最近三天  " } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onConfirm).toHaveBeenCalledWith("最近三天");
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("does not send an ask_user answer while an IME composition is confirming", () => {
    const onConfirm = vi.fn();
    renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-ask",
          function_name: "ask_user",
          arguments: JSON.stringify({ question: "简报要覆盖最近几天？" }),
        }}
        onConfirm={onConfirm}
        onDeny={vi.fn()}
      />,
    );

    const answer = screen.getByLabelText("你的回答");
    fireEvent.change(answer, { target: { value: "最近三天" } });
    expect(fireEvent.keyDown(answer, { key: "Enter", metaKey: true, isComposing: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(answer, { key: "Enter", ctrlKey: true, isComposing: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(answer, { key: "Enter", ctrlKey: true, keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(answer, { key: "Process", ctrlKey: true, keyCode: 229 })).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(answer).toHaveValue("最近三天");

    expect(fireEvent.keyDown(answer, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith("最近三天");
  });

  it("keeps the ask_user answer while resolve is in flight", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();
    const tool = {
      index: 0,
      id: "tc-ask",
      function_name: "ask_user",
      arguments: JSON.stringify({ question: "简报要覆盖最近几天？" }),
    };
    const { rerender } = renderWithRouter(
      <ConfirmationDialog
        toolCall={tool}
        busyAction={null}
        onConfirm={onConfirm}
        onDeny={onDeny}
      />,
    );
    const answer = screen.getByLabelText("你的回答");
    fireEvent.change(answer, { target: { value: "最近三天" } });
    const send = screen.getByRole("button", { name: "发送回答" });
    send.focus();
    rerender(
      <ConfirmationDialog
        toolCall={tool}
        busyAction="confirm"
        onConfirm={onConfirm}
        onDeny={onDeny}
      />,
    );
    expect(answer).toHaveValue("最近三天");
    expect(answer).toBeEnabled();
    expect(send).toBeEnabled();
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(send).toHaveFocus();
    expect(screen.getByRole("button", { name: "取消" })).not.toHaveAttribute("aria-busy");
    fireEvent.click(send);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(answer, { key: "Enter", ctrlKey: true });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("keeps the confirm button enabled and ignores cancel while that resolve is in flight", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();
    const { rerender } = renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={onConfirm} onDeny={onDeny} />,
    );
    const confirm = screen.getByRole("button", { name: "确认写入" });
    const cancel = screen.getByRole("button", { name: "取消" });
    confirm.focus();
    rerender(
      <ConfirmationDialog
        toolCall={toolCall}
        busyAction="confirm"
        onConfirm={onConfirm}
        onDeny={onDeny}
      />,
    );
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toHaveFocus();
    expect(cancel).toBeEnabled();
    expect(cancel).not.toHaveAttribute("aria-busy");
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("cancels ask_user without sending an answer", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();
    const { container } = renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-ask",
          function_name: "ask_user",
          arguments: JSON.stringify({ question: "用哪份资料？" }),
        }}
        onConfirm={onConfirm}
        onDeny={onDeny}
      />,
    );
    fireEvent.click(within(container).getByRole("button", { name: "取消" }));
    expect(onDeny).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onDeny when user cancels", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();

    const { container } = renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={onConfirm} onDeny={onDeny} />,
    );

    const denyBtn = within(container).getByRole("button", { name: "取消" });
    fireEvent.click(denyBtn);

    expect(onDeny).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows patch preview for apply_patch", () => {
    renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-2",
          function_name: "apply_patch",
          arguments: JSON.stringify({
            path: "/tmp/app.py",
            old_string: "return 'hi'",
            new_string: "return 'hello'",
          }),
        }}
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByText("变更预览")).toBeInTheDocument();
    expect(screen.getByText(/− return 'hi'/)).toBeInTheDocument();
    expect(screen.getByText(/\+ return 'hello'/)).toBeInTheDocument();
  });

  it("shows write preview for write_file", () => {
    renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-3",
          function_name: "write_file",
          arguments: JSON.stringify({
            path: "/tmp/app.py",
            content: "print('hello world')",
          }),
        }}
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByText("写入内容预览")).toBeInTheDocument();
    expect(screen.getAllByText(/print\('hello world'\)/).length).toBeGreaterThan(0);
  });

  it("shows suggestion framing for set_timer", () => {
    renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-5",
          function_name: "set_timer",
          arguments: JSON.stringify({ delay_seconds: 3600, message: "交报告" }),
        }}
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByText("建议：创建定时提醒")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认创建" })).toBeInTheDocument();
  });

  it("shows suggestion framing for send_email", () => {
    renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-6",
          function_name: "send_email",
          arguments: JSON.stringify({ to: "a@b.com", subject: "hi" }),
        }}
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByText("建议：发送邮件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认发送" })).toBeInTheDocument();
  });

  it("shows default suggestion framing for computer_click", () => {
    renderWithRouter(
      <ConfirmationDialog
        toolCall={{
          index: 0,
          id: "tc-7",
          function_name: "computer_click",
          arguments: JSON.stringify({ x: 10, y: 20 }),
        }}
        onConfirm={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: /^建议：/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认执行" })).toBeInTheDocument();
  });
});
