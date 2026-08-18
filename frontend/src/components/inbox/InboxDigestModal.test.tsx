import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("link", { name: "billing@example.com" })).toBeInTheDocument();
    expect(screen.queryByText(/## 重要/)).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<InboxDigestModal open title="今日摘要" content="无新邮件" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
