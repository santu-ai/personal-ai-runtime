import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import { installMcpConnector, listMcpRegistry } from "../../api/connectors";
import McpMarketplace from "./McpMarketplace";

vi.mock("../../api/connectors", () => ({
  listMcpRegistry: vi.fn(),
  installMcpConnector: vi.fn(),
}));

const reveal = [
  "truncate",
  "group-has-[:focus-visible]:overflow-visible",
  "group-has-[:focus-visible]:whitespace-normal",
  "group-has-[:focus-visible]:text-clip",
  "group-has-[:focus-visible]:break-words",
];

function server(
  name: string,
  description: string,
  installed = false,
): {
  name: string;
  description: string;
  category: string;
  env_vars: Record<string, string>;
  installed: boolean;
} {
  return { name, description, category: "search", env_vars: {}, installed };
}

describe("McpMarketplace descriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the full description when the line or 安装 is keyboard focused", async () => {
    const description =
      "浏览器自动化 — 导航页面、截图、点击元素，平时只占一行，键盘落到时要写出整句";
    vi.mocked(listMcpRegistry).mockResolvedValue([
      server("playwright", description),
      server("installed-one", "已经装上的说明平时也只占一行，键盘仍可以落到这一句", true),
      server("blank", "   "),
      server("empty", ""),
    ]);
    renderWithRouter(<McpMarketplace />);

    const line = await screen.findByText(description);
    expect(line).toHaveClass(...reveal, "focus-visible:ring-focus-ring");
    expect(line.className).not.toContain("group-hover:");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).not.toHaveAttribute("title");
    expect(line.closest("a")).toBeNull();
    expect(line.closest("button")).toBeNull();

    const row = line.closest(".group");
    expect(row).not.toBeNull();
    const install = within(row as HTMLElement).getByRole("button", { name: "安装" });
    expect(install).toBeEnabled();
    expect(row).toContainElement(install);

    expect(fireEvent.keyDown(line, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(line, { key: " ", keyCode: 229 })).toBe(true);
    expect(installMcpConnector).not.toHaveBeenCalled();

    const installed = screen.getByText("已经装上的说明平时也只占一行，键盘仍可以落到这一句");
    expect(installed).toHaveClass(...reveal);
    expect(installed.className).not.toContain("group-hover:");
    expect(installed).toHaveAttribute("tabindex", "0");
    const installedRow = installed.closest(".group");
    expect(
      within(installedRow as HTMLElement).getByRole("button", { name: "已安装" }),
    ).toBeDisabled();

    for (const name of ["blank", "empty"]) {
      const blankRow = screen.getByText(name).closest(".group");
      expect(blankRow?.querySelector(".truncate")).toBeNull();
      expect(blankRow?.querySelector("[tabindex='0']")).toBeNull();
    }
  });
});
