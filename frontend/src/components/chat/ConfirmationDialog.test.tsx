import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import ConfirmationDialog from "./ConfirmationDialog";
import { renderWithRouter } from "../../test-utils";

vi.mock("../../hooks/useSettingsQuery", () => ({
  useCapabilityPolicyQuery: () => ({
    data: {
      auto_allow: ["read_file"],
      needs_user: ["write_file", "apply_patch", "send_email"],
      forbidden: ["shell_exec"],
      external_ingestion: [],
    },
    isLoading: false,
    error: null,
  }),
}));

afterEach(() => {
  cleanup();
});

const toolCall = {
  index: 0,
  id: "tc-1",
  function_name: "write_file",
  arguments: JSON.stringify({ path: "/tmp/test.txt", content: "hello" }),
};

describe("ConfirmationDialog", () => {
  it("renders human-readable label and expandable arguments", () => {
    renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={vi.fn()} onDeny={vi.fn()} />,
    );

    expect(screen.getByText(/确认写入文件/)).toBeInTheDocument();
    expect(screen.getByText(/确认后将执行工具并自动续写一次回复/)).toBeInTheDocument();
    const summary = screen.getByText("查看详细参数");
    fireEvent.click(summary);
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });

  it("calls onConfirm when user approves", () => {
    const onConfirm = vi.fn();
    const onDeny = vi.fn();

    const { container } = renderWithRouter(
      <ConfirmationDialog toolCall={toolCall} onConfirm={onConfirm} onDeny={onDeny} />,
    );

    const confirmBtn = within(container).getByRole("button", { name: "确认执行" });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onDeny).not.toHaveBeenCalled();
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
});
