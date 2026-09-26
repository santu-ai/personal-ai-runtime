import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaskTrack from "./TaskTrack";

const multiToolCalls = [
  {
    index: 0,
    id: "tc-1",
    function_name: "read_file",
    arguments: JSON.stringify({ path: "/tmp/test.txt" }),
  },
  {
    index: 1,
    id: "tc-2",
    function_name: "web_search",
    arguments: JSON.stringify({ query: "hello" }),
  },
];

function renderWithRouter(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

describe("TaskTrack", () => {
  it("documents parent contract: single-stage should not be mounted by MessageItem", () => {
    // TaskTrack itself always renders when mounted (hooks-safe).
    // MessageItem must gate with toolCalls.length > 1 before mounting.
    renderWithRouter(<TaskTrack stages={[{ toolCall: multiToolCalls[0] }]} />);
    expect(screen.getByText("任务轨迹")).toBeInTheDocument();
    expect(screen.getByText("0/1 完成")).toBeInTheDocument();
  });

  it("renders multi-step timeline with correct count", () => {
    renderWithRouter(<TaskTrack stages={multiToolCalls.map((tc) => ({ toolCall: tc }))} />);
    expect(screen.getByText("任务轨迹")).toBeInTheDocument();
    expect(screen.getByText("0/2 完成")).toBeInTheDocument();
    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText("搜索网页")).toBeInTheDocument();
  });

  it("shows completed count when results present", () => {
    renderWithRouter(
      <TaskTrack
        stages={multiToolCalls.map((tc, i) => ({
          toolCall: tc,
          result:
            i === 0
              ? { tool_name: "read_file", tool_call_id: "tc-1", content: '{"ok": true}' }
              : undefined,
        }))}
      />,
    );
    expect(screen.getByText("1/2 完成")).toBeInTheDocument();
    expect(screen.getByText("✓ 完成")).toBeInTheDocument();
    expect(screen.getAllByText("执行中").length).toBeGreaterThanOrEqual(1);
  });

  it("shows failed status for error results", () => {
    renderWithRouter(
      <TaskTrack
        stages={[
          {
            toolCall: multiToolCalls[0],
            result: {
              tool_name: "read_file",
              tool_call_id: "tc-1",
              content: '{"error": "file not found"}',
            },
          },
          { toolCall: multiToolCalls[1] },
        ]}
      />,
    );
    expect(screen.getByText("✗ 失败")).toBeInTheDocument();
  });

  it("shows failed status for plain-text error results", () => {
    renderWithRouter(
      <TaskTrack
        stages={[
          {
            toolCall: multiToolCalls[0],
            result: {
              tool_name: "read_file",
              tool_call_id: "tc-1",
              content: "Error: file not found",
            },
          },
          { toolCall: multiToolCalls[1] },
        ]}
      />,
    );
    expect(screen.getByText("✗ 失败")).toBeInTheDocument();
  });

  it("writes the full tool name when that step is keyboard focused", () => {
    const name = "zzzz_quill_marker_blob_that_stays_clipped_on_one_line";
    renderWithRouter(
      <TaskTrack
        stages={[
          { toolCall: multiToolCalls[0] },
          {
            toolCall: {
              index: 2,
              id: "tc-long",
              function_name: name,
              arguments: "{}",
            },
          },
        ]}
      />,
    );
    const label = "zzzz quill marker blob that stays clipped on one line";
    const line = screen.getByText(label);
    const button = line.closest("button");
    expect(button).toHaveClass("group", "focus-visible:ring-focus-ring");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(line).toHaveClass(
      "truncate",
      "group-focus-visible:overflow-visible",
      "group-focus-visible:whitespace-normal",
      "group-focus-visible:text-clip",
      "group-focus-visible:break-words",
    );
    expect(line.className).not.toContain("group-hover:");
    expect(line).not.toHaveAttribute("title");
    expect(line).not.toHaveAttribute("tabindex");
    expect(line.closest("button")).toBe(button);

    const short = screen.getByText("读取文件");
    expect(short).toHaveClass("truncate", "group-focus-visible:whitespace-normal");
    expect(short.className).not.toContain("group-hover:");

    expect(fireEvent.keyDown(button!, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(button!, { key: "Enter" })).toBe(true);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("expands details on click", () => {
    renderWithRouter(<TaskTrack stages={multiToolCalls.map((tc) => ({ toolCall: tc }))} />);
    fireEvent.click(screen.getByText("读取文件"));
    expect(screen.getByText("参数")).toBeInTheDocument();
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });

  it("writes the full plain-text result when the keyboard lands, and keeps a short preview otherwise", () => {
    const long = `行\n${"字".repeat(600)}`;
    const exact = "b".repeat(500);
    const json = JSON.stringify({ note: "段".repeat(600) });
    renderWithRouter(
      <TaskTrack
        stages={[
          {
            toolCall: multiToolCalls[0],
            result: { tool_name: "read_file", tool_call_id: "tc-1", content: long },
          },
          {
            toolCall: multiToolCalls[1],
            result: { tool_name: "web_search", tool_call_id: "tc-2", content: exact },
          },
          {
            toolCall: {
              index: 2,
              id: "tc-3",
              function_name: "shell_exec",
              arguments: JSON.stringify({ command: "true" }),
            },
            result: { tool_name: "shell_exec", tool_call_id: "tc-3", content: json },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("读取文件"));
    const box = document.querySelector("[data-tool-result-preview]");
    if (!box) throw new Error("missing tool result preview");
    expect(box).toHaveAttribute("title", long);
    expect(box).toHaveAttribute("data-tool-result-preview", "");
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveClass(
      "group",
      "max-h-24",
      "overflow-y-auto",
      "focus-visible:max-h-none",
      "focus-visible:overflow-visible",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    expect(box.className).not.toContain("group-hover:");
    expect(box.closest("button")).toBeNull();
    const step = screen.getByRole("button", { name: /读取文件/ });
    expect(step).toHaveAttribute("aria-expanded", "true");
    const preview = `${long.slice(0, 500)}\n... [truncated]`;
    const short = box.querySelector(".group-focus-visible\\:hidden");
    const full = box.querySelector(".group-focus-visible\\:block");
    expect(short?.textContent).toBe(preview);
    expect(short).toHaveClass("group-focus-visible:hidden");
    expect(full).toHaveClass("hidden", "group-focus-visible:block");
    expect(full?.textContent).toBe(long);

    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(step).toHaveAttribute("aria-expanded", "true");
    expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: " ", keyCode: 229 })).toBe(true);

    fireEvent.click(screen.getByText("搜索网页"));
    expect(screen.getByText(exact).closest("[data-tool-result-preview]")).toBeNull();
    expect(screen.getByText(exact)).not.toHaveAttribute("tabindex");

    fireEvent.click(screen.getByText("执行命令"));
    const jsonNote = "段".repeat(600);
    expect(screen.getByText(new RegExp(jsonNote)).closest("[data-tool-result-preview]")).toBeNull();
    expect(screen.getByText(new RegExp(jsonNote)).textContent).not.toContain("[truncated]");
  });
});
