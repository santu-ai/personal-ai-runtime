import { describe, expect, it } from "vitest";
import { FileText, Search } from "lucide-react";
import { toolLabel, toolIcon, describeToolAction, visibleToolName } from "./toolLabels";

describe("toolLabels", () => {
  it("returns Chinese label for known builtin tools", () => {
    expect(toolLabel("read_file")).toBe("读取文件");
    expect(toolLabel("web_search")).toBe("搜索网页");
  });

  it("returns lucide icon for known tools", () => {
    expect(toolIcon("read_file")).toBe(FileText);
  });

  it("describes tool action with args", () => {
    const desc = describeToolAction("read_file", { path: "/tmp/foo.txt" });
    expect(desc).toContain("/tmp/foo.txt");
    expect(desc).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("falls back for unknown tools", () => {
    const label = toolLabel("playwright_browser_navigate");
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe("playwright_browser_navigate");
  });

  it("falls back icon for unknown search-like tools", () => {
    expect(toolIcon("custom_search_tool")).toBe(Search);
  });

  it("writes the same Chinese name and keeps a blank action as the empty copy", () => {
    expect(visibleToolName("write_file", "未知操作")).toBe("写入文件");
    expect(visibleToolName("  send_email  ", "未知操作")).toBe("发送邮件");
    expect(visibleToolName("shell_exec", "未知操作")).toBe("执行命令");
    expect(visibleToolName("", "未知操作")).toBe("未知操作");
    expect(visibleToolName("   ", "未知操作")).toBe("未知操作");
    expect(visibleToolName(null, "未知操作")).toBe("未知操作");
    expect(visibleToolName(undefined, "未知操作")).toBe("未知操作");
    const raw = "mcp_filesystem__read_a_very_long_tool_name";
    const shown = visibleToolName(raw, raw);
    expect(shown).not.toBe(raw);
    expect(shown).not.toContain("_");
    expect(visibleToolName("mcp_shell__run_custom_tool", "未知操作")).toBe(
      "mcp shell run custom tool",
    );
  });
});
