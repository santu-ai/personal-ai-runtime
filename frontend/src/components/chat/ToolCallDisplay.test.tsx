import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToolCallDisplay from "./ToolCallDisplay";

describe("ToolCallDisplay", () => {
  const toolCalls = [
    {
      index: 0,
      id: "tc-1",
      function_name: "read_file",
      arguments: JSON.stringify({ path: "/tmp/test.txt" }),
    },
  ];

  it("renders tool label in Chinese", () => {
    render(<ToolCallDisplay toolCalls={toolCalls} toolResults={[]} />);
    expect(screen.getByText(/读取文件/)).toBeInTheDocument();
  });

  it("shows completed status when result present", () => {
    render(
      <ToolCallDisplay
        toolCalls={toolCalls}
        toolResults={[
          {
            tool_name: "read_file",
            tool_call_id: "tc-1",
            content: '{"ok": true}',
          },
        ]}
        defaultExpanded
      />,
    );
    expect(screen.getByText(/完成|✓/)).toBeInTheDocument();
  });

  it("renders inbox email table for check_inbox", () => {
    const inboxResult = JSON.stringify({
      count: 1,
      emails: [
        {
          from: "alice@example.com",
          subject: "Hello",
          date: "2026-06-10 10:00",
          preview: "Hi there",
        },
      ],
    });
    render(
      <ToolCallDisplay
        toolCalls={[
          {
            index: 0,
            id: "tc-inbox",
            function_name: "check_inbox",
            arguments: "{}",
          },
        ]}
        toolResults={[
          {
            tool_name: "check_inbox",
            tool_call_id: "tc-inbox",
            content: inboxResult,
          },
        ]}
        defaultExpanded
      />,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText(/alice/)).toBeInTheDocument();
  });

  it("writes the full sender and preview when that inbox row is keyboard focused", () => {
    const from = '"Alice Example" <alice.example@a-very-long-mail.example.com>';
    const preview = "这封邮件的预览平时最多两行，键盘落到这一行时要写出整段，鼠标点上去仍是两行。";
    const inboxResult = JSON.stringify({
      count: 3,
      emails: [
        {
          from,
          subject: "长发件人",
          date: "2026-06-10 10:00",
          preview,
        },
        {
          from: "bob@ex.com",
          subject: "短发件人",
          date: "2026-06-10 09:00",
          preview: "短预览也跟着这一行展开",
        },
        {
          from: "   ",
          subject: "只有主题",
          date: "",
          preview: "  ",
        },
      ],
    });
    render(
      <ToolCallDisplay
        toolCalls={[
          {
            index: 0,
            id: "tc-inbox",
            function_name: "check_inbox",
            arguments: "{}",
          },
        ]}
        toolResults={[
          {
            tool_name: "check_inbox",
            tool_call_id: "tc-inbox",
            content: inboxResult,
          },
        ]}
        defaultExpanded
      />,
    );

    const reveal = [
      "truncate",
      "group-focus-visible:overflow-visible",
      "group-focus-visible:whitespace-normal",
      "group-focus-visible:text-clip",
      "group-focus-visible:break-words",
    ];
    const swapped = screen.getByText("Alice Example").closest("tr");
    expect(swapped).toHaveAttribute("tabindex", "0");
    expect(swapped).toHaveClass("group", "focus-visible:ring-focus-ring");
    const shortFrom = swapped?.querySelector(".group-focus-visible\\:hidden");
    expect(shortFrom).toHaveTextContent("Alice Example");
    expect(shortFrom).toHaveClass("truncate", "group-focus-visible:hidden");
    expect(shortFrom?.className).not.toContain("group-hover:");
    const fullFrom = swapped?.querySelector(".group-focus-visible\\:block");
    expect(fullFrom).toHaveTextContent(from);
    expect(fullFrom).toHaveClass("hidden", "break-words", "group-focus-visible:block");
    expect(fullFrom?.className).not.toContain("group-hover:");
    expect(swapped?.querySelector("td[title]")?.getAttribute("title")).toBe(from);
    const clamped = swapped?.querySelector(".line-clamp-2");
    expect(clamped).toHaveTextContent(preview);
    expect(clamped).toHaveClass(
      "line-clamp-2",
      "group-focus-visible:line-clamp-none",
      "group-focus-visible:break-words",
    );
    expect(clamped?.className).not.toContain("group-hover:");

    expect(fireEvent.keyDown(swapped!, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(swapped!, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(swapped!, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(swapped!, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(swapped!, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(swapped!, { key: " ", keyCode: 229 })).toBe(true);

    const plain = screen.getByText("bob@ex.com").closest("tr");
    expect(plain).toHaveAttribute("tabindex", "0");
    const plainFrom = plain?.querySelector(".truncate");
    expect(plainFrom).toHaveTextContent("bob@ex.com");
    expect(plainFrom).toHaveClass(...reveal);
    expect(plainFrom?.className).not.toContain("group-hover:");
    expect(plain?.querySelector(".group-focus-visible\\:hidden")).toBeNull();
    expect(plain?.querySelector(".line-clamp-2")).toHaveClass(
      "group-focus-visible:line-clamp-none",
    );

    const subjectOnly = screen.getByText("只有主题").closest("tr");
    expect(subjectOnly).not.toHaveAttribute("tabindex");
    expect(subjectOnly?.querySelector(".truncate")).toBeNull();
    expect(subjectOnly?.querySelector(".line-clamp-2")).toBeNull();
  });

  it("toggles expand on click", () => {
    render(
      <ToolCallDisplay
        toolCalls={toolCalls}
        toolResults={[
          {
            tool_name: "read_file",
            tool_call_id: "tc-1",
            content: "result data",
          },
        ]}
      />,
    );
    const header = screen.getByText(/读取文件/).closest("button");
    if (header) {
      fireEvent.click(header);
    }
    expect(screen.getByText(/读取文件/)).toBeInTheDocument();
  });

  it("writes the full plain-text result when the keyboard lands, and keeps a short preview otherwise", () => {
    const long = `行\n${"字".repeat(600)}`;
    const exact = "a".repeat(500);
    const json = JSON.stringify({ note: "字".repeat(600) });
    render(
      <ToolCallDisplay
        defaultExpanded
        toolCalls={[
          toolCalls[0],
          {
            index: 1,
            id: "tc-exact",
            function_name: "shell_exec",
            arguments: JSON.stringify({ command: "true" }),
          },
          {
            index: 2,
            id: "tc-json",
            function_name: "web_search",
            arguments: JSON.stringify({ query: "q" }),
          },
        ]}
        toolResults={[
          { tool_name: "read_file", tool_call_id: "tc-1", content: long },
          { tool_name: "shell_exec", tool_call_id: "tc-exact", content: exact },
          { tool_name: "web_search", tool_call_id: "tc-json", content: json },
        ]}
      />,
    );

    const box = document.querySelector("[data-tool-result-preview]");
    if (!box) throw new Error("missing tool result preview");
    expect(box).toHaveAttribute("title", long);
    expect(box).toHaveAttribute("data-tool-result-preview", "");
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveClass(
      "group",
      "max-h-64",
      "overflow-y-auto",
      "focus-visible:max-h-none",
      "focus-visible:overflow-visible",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    expect(box.className).not.toContain("group-hover:");
    expect(box.closest("button")).toBeNull();
    const preview = `${long.slice(0, 500)}\n... [truncated]`;
    const short = box.querySelector(".group-focus-visible\\:hidden");
    const full = box.querySelector(".group-focus-visible\\:block");
    expect(short?.textContent).toBe(preview);
    expect(short).toHaveClass("group-focus-visible:hidden");
    expect(short?.className).not.toContain("group-hover:");
    expect(full).toHaveClass("hidden", "group-focus-visible:block");
    expect(full?.textContent).toBe(long);
    expect(long.includes("\n")).toBe(true);

    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: " ", keyCode: 229 })).toBe(true);

    fireEvent.click(screen.getByText("执行命令"));
    expect(screen.getByText(exact).closest("[data-tool-result-preview]")).toBeNull();
    expect(screen.getByText(exact)).not.toHaveAttribute("tabindex");

    fireEvent.click(screen.getByText("搜索网页"));
    const jsonNote = "字".repeat(600);
    expect(screen.getByText(new RegExp(jsonNote))).not.toHaveAttribute("tabindex");
    expect(screen.getByText(new RegExp(jsonNote)).closest("[data-tool-result-preview]")).toBeNull();
    expect(screen.getByText(new RegExp(jsonNote)).textContent).not.toContain("[truncated]");
  });
});
