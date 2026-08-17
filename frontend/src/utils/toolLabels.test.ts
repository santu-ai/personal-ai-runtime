import { describe, expect, it } from "vitest";
import { FileText, Search } from "lucide-react";
import { toolLabel, toolIcon, describeToolAction } from "./toolLabels";

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
});
