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
    const install = within(row as HTMLElement).getByRole("button", { name: "安装：playwright" });
    expect(install).toHaveTextContent("安装");
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
      within(installedRow as HTMLElement).getByRole("button", { name: "已安装：installed-one" }),
    ).toBeDisabled();

    for (const name of ["blank", "empty"]) {
      const blankRow = screen.getByText(name).closest(".group");
      const lines = blankRow?.querySelectorAll(".truncate") ?? [];
      expect(lines).toHaveLength(1);
      expect(lines[0]).toHaveTextContent(name);
      expect(blankRow?.querySelectorAll("[tabindex='0']")).toHaveLength(1);
    }
  });

  it("writes the full marketplace name when the name or 安装 is keyboard focused", async () => {
    const name = "browser_automation_a_very_long_marketplace_name_that_used_to_stay_clipped";
    vi.mocked(listMcpRegistry).mockResolvedValue([
      server(name, "短说明"),
      server("already-installed", "已经装上", true),
      server("   ", "空白名称不占焦点"),
    ]);
    renderWithRouter(<McpMarketplace />);

    const line = await screen.findByText(name);
    expect(line).toHaveClass(...reveal, "focus-visible:ring-focus-ring");
    expect(line.className).not.toContain("group-hover:");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).not.toHaveAttribute("title");
    expect(line.closest("a")).toBeNull();
    expect(line.closest("button")).toBeNull();

    const row = line.closest(".group");
    expect(row).not.toBeNull();
    const install = within(row as HTMLElement).getByRole("button", {
      name: `安装：${name}`,
    });
    expect(install).toBeEnabled();
    expect(row).toContainElement(install);

    expect(fireEvent.keyDown(line, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(line, { key: " ", keyCode: 229 })).toBe(true);
    expect(installMcpConnector).not.toHaveBeenCalled();

    const installed = screen.getByText("already-installed");
    expect(installed).toHaveClass(...reveal);
    expect(installed.className).not.toContain("group-hover:");
    expect(installed).toHaveAttribute("tabindex", "0");
    const installedRow = installed.closest(".group");
    expect(
      within(installedRow as HTMLElement).getByRole("button", {
        name: "已安装：already-installed",
      }),
    ).toBeDisabled();

    const blankRow = screen.getByText("空白名称不占焦点").closest(".group");
    const blankName = blankRow?.querySelector(".font-medium");
    expect(blankName?.textContent).toBe("   ");
    expect(blankName?.className).not.toContain("truncate");
    expect(blankName).not.toHaveAttribute("tabindex");
    expect(within(blankRow as HTMLElement).getByRole("button")).not.toHaveAttribute("aria-label");
    expect(within(blankRow as HTMLElement).getByRole("button")).toHaveTextContent("安装");
  });

  it("names 安装 with this server and leaves the visible word", async () => {
    vi.mocked(listMcpRegistry).mockResolvedValue([
      {
        name: "  前  后  ",
        description: "说明不进名字",
        category: "browser",
        env_vars: { API_KEY: "secret" },
        installed: false,
      },
      {
        name: "前一段\n后一段",
        description: "另一句说明",
        category: "search",
        env_vars: {},
        installed: true,
      },
      server("   ", "空白说明也不进名字"),
      server("", "空名称"),
    ]);
    renderWithRouter(<McpMarketplace />);

    const installOf = (name: string) => {
      const node = [...document.querySelectorAll("button[data-mcp-install]")].find(
        (button) => button.getAttribute("data-mcp-install") === name,
      );
      if (!node) throw new Error(`missing install ${JSON.stringify(name)}`);
      return node;
    };

    await screen.findByText("说明不进名字");
    const spaced = installOf("  前  后  ");
    expect(spaced).toHaveTextContent("安装");
    expect(spaced).toHaveAttribute("aria-label", "安装：前  后");
    expect(spaced.getAttribute("aria-label")).not.toMatch(/说明不进名字|浏览器|API_KEY|secret/);

    const broken = installOf("前一段\n后一段");
    expect(broken).toHaveTextContent("已安装");
    expect(broken).toBeDisabled();
    expect(broken).toHaveAttribute("aria-label", "已安装：前一段\n后一段");
    expect(broken.getAttribute("aria-label")).not.toMatch(/另一句说明|搜索/);

    for (const description of ["空白说明也不进名字", "空名称"]) {
      const row = screen.getByText(description).closest(".group");
      const button = within(row as HTMLElement).getByRole("button", { name: "安装" });
      expect(button).not.toHaveAttribute("aria-label");
      expect(button).toHaveTextContent("安装");
    }
  });
});
