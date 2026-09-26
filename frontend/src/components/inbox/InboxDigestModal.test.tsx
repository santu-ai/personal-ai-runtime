import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import InboxDigestModal from "./InboxDigestModal";

vi.mock("../chat/LazyMarkdown", () => ({
  LazyMarkdown: ({
    content,
    components,
  }: {
    content: string;
    components?: React.ComponentProps<typeof ReactMarkdown>["components"];
  }) => (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
      {content}
    </ReactMarkdown>
  ),
}));

const DIGEST = `# 收件箱每日摘要
日期: 2026年08月18日

## 重要 (1)
- 八月账单 — billing@example.com
`;

describe("InboxDigestModal", () => {
  it("renders digest markdown instead of raw hashes", () => {
    render(
      <InboxDigestModal open title="收件箱摘要 - 2026-08-18" content={DIGEST} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "收件箱每日摘要" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "重要 (1)" })).toBeInTheDocument();
    expect(screen.getByText(/八月账单/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "billing@example.com" })).toHaveClass(
      "focus-visible:ring-focus-ring",
    );
    expect(screen.queryByText(/## 重要/)).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<InboxDigestModal open title="今日摘要" content="无新邮件" onClose={onClose} />);
    const close = screen
      .getAllByRole("button", { name: "关闭" })
      .find((button) => button.querySelector("[data-icon-name]"));
    expect(close?.querySelector("[data-icon-name]")).toHaveTextContent("关闭");
    expect(close?.querySelector("[data-icon-name]")).toHaveClass(
      "hidden",
      "group-focus-visible:block",
    );
    expect(close?.querySelector("[aria-hidden]")).toHaveClass("group-focus-visible:hidden");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("wraps a fenced line longer than 80 characters when the keyboard lands on it", () => {
    const line = "a".repeat(81);
    const content = ["短的说明", "", "```", `short`, line, "```", ""].join("\n");
    render(<InboxDigestModal open title="今日摘要" content={content} onClose={vi.fn()} />);

    const box = document.querySelector("[data-digest-code]");
    if (!box) throw new Error("missing digest code");
    expect(box.tagName).toBe("PRE");
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAttribute("title", box.textContent);
    expect(box.textContent).toContain(line);
    expect(box).toHaveClass(
      "focus-visible:overflow-visible",
      "focus-visible:whitespace-pre-wrap",
      "focus-visible:break-all",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    expect(box.className).not.toContain("group-hover:");
    expect(box.className).not.toContain("hover:whitespace");
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();

    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(box, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(box, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(box, { key: " ", keyCode: 229 })).toBe(true);
  });

  it("does not give a long inline code span its own focus stop", () => {
    const line = "c".repeat(81);
    render(
      <InboxDigestModal open title="今日摘要" content={`见 \`${line}\` 这里`} onClose={vi.fn()} />,
    );
    expect(document.querySelector("[data-digest-code]")).toBeNull();
    expect(document.querySelector("pre")).toBeNull();
    const code = screen.getByText(line).closest("code");
    expect(code).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
  });

  it("does not add a focus stop when every fenced line is at most 80 characters", () => {
    const exact = "b".repeat(80);
    const tall = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");
    const content = ["```js", exact, "```", "", "```", tall, "```"].join("\n");
    render(<InboxDigestModal open title="今日摘要" content={content} onClose={vi.fn()} />);

    expect(document.querySelector("[data-digest-code]")).toBeNull();
    const blocks = document.querySelectorAll("pre");
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      expect(block).not.toHaveAttribute("tabindex");
      expect(block).not.toHaveAttribute("title");
      expect(block.className).not.toContain("focus-visible:whitespace-pre-wrap");
    }
    expect(screen.getByText(exact)).toBeInTheDocument();
  });

  it("moves focus into the digest and returns it after close", async () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "查看摘要";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const view = render(
      <InboxDigestModal open title="今日摘要" content="无新邮件" onClose={onClose} />,
    );
    const dialog = screen.getByRole("dialog", { name: "今日摘要" });
    await waitFor(() => expect(dialog).toHaveFocus());
    view.rerender(
      <InboxDigestModal open={false} title="今日摘要" content="无新邮件" onClose={onClose} />,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
