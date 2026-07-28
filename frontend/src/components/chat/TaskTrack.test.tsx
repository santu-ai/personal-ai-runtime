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

  it("expands details on click", () => {
    renderWithRouter(<TaskTrack stages={multiToolCalls.map((tc) => ({ toolCall: tc }))} />);
    fireEvent.click(screen.getByText("读取文件"));
    expect(screen.getByText("参数")).toBeInTheDocument();
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });
});
