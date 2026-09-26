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
});
