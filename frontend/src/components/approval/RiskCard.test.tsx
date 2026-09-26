import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import RiskCard from "./RiskCard";
import type { CapabilityPolicy } from "../../api/settings";

afterEach(() => {
  cleanup();
});

function preWithText(text: string): HTMLElement {
  const pre = [...document.querySelectorAll("pre")].find((node) => node.textContent === text);
  if (!pre) throw new Error("missing pre");
  return pre;
}

const policy: CapabilityPolicy = {
  auto_allow: ["read_file"],
  needs_user: ["write_file", "apply_patch"],
  forbidden: ["shell_exec", "send_email"],
  external_ingestion: [],
};

describe("RiskCard", () => {
  it("renders high-risk badge for forbidden tools via policy", () => {
    renderWithRouter(
      <RiskCard
        action="shell_exec"
        args={JSON.stringify({ command: "rm -rf /" })}
        policy={policy}
        variant="inline"
      />,
    );
    expect(screen.getByText(/确认执行命令/)).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
  });

  it("renders high-risk badge for needs_user via policy", () => {
    // needs_user maps to high in getRiskLevelFromPolicy
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: "hi" })}
        policy={policy}
        variant="inline"
      />,
    );
    expect(screen.getByText(/确认写入文件/)).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
  });

  it("respects explicit riskLevel over policy", () => {
    renderWithRouter(
      <RiskCard action="shell_exec" args="{}" policy={policy} riskLevel="low" variant="inline" />,
    );
    expect(screen.queryByText("高风险")).not.toBeInTheDocument();
  });

  it("renders low-risk style for auto_allow tools via policy", () => {
    renderWithRouter(
      <RiskCard
        action="read_file"
        args={JSON.stringify({ path: "/tmp/a.txt" })}
        policy={policy}
        variant="inline"
      />,
    );
    expect(screen.queryByText("高风险")).not.toBeInTheDocument();
    expect(screen.getByText(/确认读取文件/)).toBeInTheDocument();
  });

  it("shows patch preview for apply_patch", () => {
    renderWithRouter(
      <RiskCard
        action="apply_patch"
        args={JSON.stringify({
          path: "/tmp/a.py",
          old_string: "a",
          new_string: "b",
        })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    expect(screen.getByText("变更预览")).toBeInTheDocument();
  });

  it("shows write preview for write_file", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: "hello world" })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    expect(screen.getByText("写入内容预览")).toBeInTheDocument();
  });

  it("expands long patch content", () => {
    const longText = "x".repeat(500);
    renderWithRouter(
      <RiskCard
        action="apply_patch"
        args={JSON.stringify({ path: "/tmp/a.py", old_string: longText, new_string: "y" })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    expect(screen.getByText("查看完整内容")).toBeInTheDocument();
  });

  it("falls back label for unknown action", () => {
    renderWithRouter(
      <RiskCard action="nonexistent_tool" args="{}" riskLevel="medium" variant="inline" />,
    );
    expect(screen.getByRole("heading", { name: /确认/ })).toBeInTheDocument();
  });

  it("hides reversible/impact block when fields are omitted", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt" })}
        riskLevel="medium"
        variant="panel"
      />,
    );
    expect(screen.queryByText("影响：")).not.toBeInTheDocument();
    expect(screen.queryByText("可撤销：")).not.toBeInTheDocument();
  });

  it("shows reversible/impact when backend fields are provided", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args="{}"
        riskLevel="medium"
        variant="panel"
        reversible={false}
        impactSummary="覆盖目标文件"
      />,
    );
    expect(screen.getByText("影响：")).toBeInTheDocument();
    expect(screen.getByText("覆盖目标文件")).toBeInTheDocument();
    expect(screen.getByText("可撤销：")).toBeInTheDocument();
    expect(screen.getByText("否")).toBeInTheDocument();
  });

  it("links the flow label when taskHref is set", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args="{}"
        riskLevel="medium"
        variant="panel"
        source={{ flowLabel: "周报", taskHref: "/tasks/brief%2F1" }}
      />,
    );
    expect(screen.getByRole("link", { name: "周报" })).toHaveAttribute("href", "/tasks/brief%2F1");
  });

  it("keeps the flow label as plain text without a task href", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args="{}"
        riskLevel="medium"
        variant="panel"
        source={{ flowLabel: "只有空白", taskHref: "   " }}
      />,
    );
    expect(screen.getByText("只有空白")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an open-task link when taskHref has no flow label", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args="{}"
        riskLevel="medium"
        variant="panel"
        source={{ taskHref: "/tasks/task_9" }}
      />,
    );
    expect(screen.getByRole("link", { name: "打开任务" })).toHaveAttribute("href", "/tasks/task_9");
  });

  it("writes the full action sentence when that line is keyboard focused", () => {
    const command = "rm -rf /tmp/a_very_long_path_that_used_to_stay_truncated_until_keyboard_focus";
    renderWithRouter(
      <RiskCard
        action="shell_exec"
        args={JSON.stringify({ command })}
        riskLevel="high"
        variant="panel"
      >
        <button type="button">批准</button>
      </RiskCard>,
    );
    const line = screen.getByText(`$ ${command}`);
    expect(line.tagName).toBe("P");
    expect(line).toHaveClass(
      "truncate",
      "focus-visible:overflow-visible",
      "focus-visible:whitespace-normal",
      "focus-visible:text-clip",
      "focus-visible:break-words",
      "focus-visible:ring-focus-ring",
    );
    expect(line.className).not.toContain("group-hover:");
    expect(line.className).not.toContain("hover:whitespace");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).toHaveAttribute("title", `$ ${command}`);
    expect(line.closest("button")).toBeNull();
    expect(line.closest("a")).toBeNull();
    expect(screen.getByRole("button", { name: "批准" })).toBeEnabled();

    expect(fireEvent.keyDown(line, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(line, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(line, { key: " ", keyCode: 229 })).toBe(true);
  });

  it("expands detailed args", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt" })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    fireEvent.click(screen.getByText("查看详细参数"));
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
  });

  it("closes the open details on Escape and leaves the summary focused", () => {
    renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: "y".repeat(401) })}
        riskLevel="medium"
        variant="inline"
      />,
    );
    const argsSummary = screen.getByText("查看详细参数");
    fireEvent.click(argsSummary);
    const argsDetails = argsSummary.closest("details");
    expect(argsDetails).toHaveProperty("open", true);
    argsSummary.focus();
    fireEvent.keyDown(argsSummary, { key: "Escape", isComposing: true });
    fireEvent.keyDown(argsSummary, { key: "Escape", keyCode: 229 });
    expect(argsDetails).toHaveProperty("open", true);

    expect(fireEvent.keyDown(argsSummary, { key: "Escape" })).toBe(false);
    expect(argsDetails).toHaveProperty("open", false);
    expect(argsSummary).toHaveFocus();
    expect(fireEvent.keyDown(argsSummary, { key: "Escape" })).toBe(true);

    const writeSummary = screen.getByText("查看写入内容");
    fireEvent.click(writeSummary);
    const writeDetails = writeSummary.closest("details");
    expect(writeDetails).toHaveProperty("open", true);
    const full = screen.getByText("查看完整内容");
    fireEvent.click(full);
    const fullDetails = full.closest("details");
    expect(fullDetails).toHaveProperty("open", true);
    expect(fullDetails).not.toBe(writeDetails);
    full.focus();
    fireEvent.keyDown(full, { key: "Escape" });
    expect(fullDetails).toHaveProperty("open", false);
    expect(full).toHaveFocus();
    expect(writeDetails).toHaveProperty("open", true);
    fireEvent.keyDown(writeSummary, { key: "Escape" });
    expect(writeDetails).toHaveProperty("open", false);
    expect(writeSummary).toHaveFocus();
  });

  it("writes the full detailed args when the keyboard lands, and leaves a short block alone", () => {
    const wide = JSON.stringify({ k: "x".repeat(72) }, null, 2);
    const exact = JSON.stringify({ k: "x".repeat(71) }, null, 2);
    const tall = JSON.stringify({ a: "1", b: "2", c: "3", d: "4" }, null, 2);
    const fit = JSON.stringify({ a: "1", b: "2", c: "3" }, null, 2);
    expect(wide.split("\n").some((line) => line.length > 80)).toBe(true);
    expect(exact.split("\n").every((line) => line.length <= 80)).toBe(true);
    expect(tall.split("\n")).toHaveLength(6);
    expect(fit.split("\n")).toHaveLength(5);

    const { rerender } = renderWithRouter(
      <RiskCard action="read_file" args={JSON.stringify({ k: "x".repeat(72) })} riskLevel="low" />,
    );

    fireEvent.click(screen.getByText("查看详细参数"));
    const box = document.querySelector("[data-approval-capped='args']");
    if (!box) throw new Error("missing args preview");
    expect(box).toHaveAttribute("title", wide);
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
    expect(box.closest("summary")).toBeNull();
    const details = screen.getByText("查看详细参数").closest("details");
    const openBefore = (details as HTMLDetailsElement).open;
    const body = box.querySelector("pre");
    expect(body?.textContent).toBe(wide);
    expect(body).toHaveClass(
      "group-focus-visible:overflow-visible",
      "group-focus-visible:whitespace-pre-wrap",
      "group-focus-visible:break-all",
    );
    expect(body?.className).not.toContain("group-hover:");
    expect(body?.className).not.toContain("group-focus-visible:hidden");

    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect((details as HTMLDetailsElement).open).toBe(openBefore);
    expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: " ", keyCode: 229 })).toBe(true);

    rerender(
      <RiskCard action="read_file" args={JSON.stringify({ k: "x".repeat(71) })} riskLevel="low" />,
    );
    expect(document.querySelector("[data-approval-capped='args']")).toBeNull();
    const exactPre = preWithText(exact);
    expect(exactPre.tagName).toBe("PRE");
    expect(exactPre).not.toHaveAttribute("tabindex");
    expect(exactPre).toHaveClass("max-h-24", "overflow-y-auto", "overflow-x-auto");

    rerender(
      <RiskCard
        action="read_file"
        args={JSON.stringify({ a: "1", b: "2", c: "3", d: "4" })}
        riskLevel="low"
      />,
    );
    const tallBox = document.querySelector("[data-approval-capped='args']");
    expect(tallBox).toHaveAttribute("title", tall);
    expect(tallBox).toHaveAttribute("tabindex", "0");
    expect(tallBox?.querySelector("pre")?.textContent).toBe(tall);

    rerender(
      <RiskCard
        action="read_file"
        args={JSON.stringify({ a: "1", b: "2", c: "3" })}
        riskLevel="low"
      />,
    );
    expect(document.querySelector("[data-approval-capped='args']")).toBeNull();
    const fitPre = preWithText(fit);
    expect(fitPre.tagName).toBe("PRE");
    expect(fitPre).not.toHaveAttribute("tabindex");
    expect(fitPre).toHaveClass("max-h-24");
  });

  it("writes the full write preview when the keyboard lands, and leaves a short block alone", () => {
    const wide = "w".repeat(801);
    const exact = "w".repeat(800);
    const tall = Array.from({ length: 11 }, () => "a".repeat(40)).join("\n");
    const fit = Array.from({ length: 10 }, () => "a".repeat(40)).join("\n");
    expect(wide.length).toBeGreaterThan(400);
    expect(exact.length).toBeGreaterThan(400);

    const { rerender } = renderWithRouter(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: wide })}
        riskLevel="medium"
        variant="panel"
      />,
    );

    fireEvent.click(screen.getByText("查看完整内容"));
    const box = document.querySelector("[data-approval-capped='full']");
    if (!box) throw new Error("missing full preview");
    expect(box).toHaveAttribute("title", wide);
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveClass(
      "group",
      "max-h-40",
      "overflow-y-auto",
      "focus-visible:max-h-none",
      "focus-visible:overflow-visible",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    expect(box.className).not.toContain("group-hover:");
    expect(box.closest("button")).toBeNull();
    expect(box.closest("summary")).toBeNull();
    const details = screen.getByText("查看完整内容").closest("details");
    const openBefore = (details as HTMLDetailsElement).open;
    const body = box.querySelector("pre");
    expect(body?.textContent).toBe(wide);
    expect(body).toHaveClass("whitespace-pre-wrap", "break-all");
    expect(body?.className).not.toContain("group-focus-visible:");
    expect(body?.className).not.toContain("group-hover:");
    expect(screen.getByText(`${wide.slice(0, 400)}…`, { exact: false })).toBeInTheDocument();

    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect((details as HTMLDetailsElement).open).toBe(openBefore);
    expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: " ", keyCode: 229 })).toBe(true);

    rerender(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: exact })}
        riskLevel="medium"
        variant="panel"
      />,
    );
    expect(document.querySelector("[data-approval-capped='full']")).toBeNull();
    expect(screen.getByText("查看完整内容")).toBeInTheDocument();
    const exactPre = preWithText(exact);
    expect(exactPre.tagName).toBe("PRE");
    expect(exactPre).not.toHaveAttribute("tabindex");
    expect(exactPre).toHaveClass("max-h-40", "overflow-y-auto", "whitespace-pre-wrap");

    rerender(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: tall })}
        riskLevel="medium"
        variant="panel"
      />,
    );
    const tallBox = document.querySelector("[data-approval-capped='full']");
    expect(tallBox).toHaveAttribute("title", tall);
    expect(tallBox).toHaveAttribute("tabindex", "0");
    expect(tallBox?.querySelector("pre")?.textContent).toBe(tall);

    rerender(
      <RiskCard
        action="write_file"
        args={JSON.stringify({ path: "/tmp/a.txt", content: fit })}
        riskLevel="medium"
        variant="panel"
      />,
    );
    expect(document.querySelector("[data-approval-capped='full']")).toBeNull();
    const fitPre = preWithText(fit);
    expect(fitPre.tagName).toBe("PRE");
    expect(fitPre).not.toHaveAttribute("tabindex");
    expect(fitPre).toHaveClass("max-h-40");
  });
});
