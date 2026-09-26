import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { McpServerStatus } from "../../api/types";
import McpServerList from "./McpServerList";

const reveal = [
  "truncate",
  "focus-visible:overflow-visible",
  "focus-visible:whitespace-normal",
  "focus-visible:text-clip",
  "focus-visible:break-words",
];

function server(
  name: string,
  status: string,
  extra: Partial<McpServerStatus> = {},
): McpServerStatus {
  return { name, status, tool_count: 0, ...extra };
}

describe("McpServerList names", () => {
  it("writes the full server name when that name is keyboard focused", () => {
    const name = "filesystem_a_very_long_mcp_server_name_that_used_to_stay_truncated";
    render(
      <McpServerList
        servers={[
          server(name, "connected", { tool_count: 3, reason: "missing_env" }),
          server("short", "disabled", { tool_count: 1 }),
          server("   ", "lazy", { tool_count: 2 }),
        ]}
      />,
    );

    const line = screen.getByText(name);
    expect(line).toHaveClass(...reveal, "focus-visible:ring-focus-ring", "min-w-0");
    expect(line.className).not.toContain("hover:");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).not.toHaveAttribute("title");
    expect(line.closest("a")).toBeNull();
    expect(line.closest("button")).toBeNull();
    expect(line.closest("li")).toHaveTextContent("已连接");
    expect(line.closest("li")).toHaveTextContent("3 工具");

    expect(fireEvent.keyDown(line, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(line, { key: " ", keyCode: 229 })).toBe(true);

    const short = screen.getByText("short");
    expect(short).toHaveClass(...reveal);
    expect(short.className).not.toContain("hover:");
    expect(short).toHaveAttribute("tabindex", "0");
    expect(short).not.toHaveAttribute("title");
    expect(short.closest("li")).toHaveTextContent("已禁用");

    const blank = screen.getByText("懒加载").closest("li");
    expect(blank?.querySelector(".truncate")).toBeNull();
    expect(blank?.querySelector("[tabindex='0']")).toBeNull();
    expect(blank).toHaveTextContent("2 工具");

    const reason = screen.getByText("缺少环境变量 / 凭证未配置");
    expect(reason).not.toHaveAttribute("tabindex");
    expect(reason.className).not.toContain("truncate");
    expect(reason).toHaveClass("break-all");
  });

  it("shows the empty list without a name focus stop", () => {
    render(<McpServerList servers={[]} />);
    expect(screen.getByText("暂无 MCP 服务器")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(document.querySelector("[tabindex='0']")).toBeNull();
  });
});
