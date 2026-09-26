import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NoticeBanner from "./NoticeBanner";
import ToastCard from "./ToastCard";

describe("NoticeBanner", () => {
  it("renders title, description and action with the given tone", () => {
    render(
      <NoticeBanner
        tone="danger"
        testId="sync-banner"
        title="同步失败"
        description="IMAP 超时"
        action={<button type="button">重试同步</button>}
      />,
    );
    expect(screen.getByTestId("sync-banner")).toBeInTheDocument();
    expect(screen.getByText("同步失败")).toBeInTheDocument();
    expect(screen.getByText("IMAP 超时")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试同步" })).toBeInTheDocument();
  });
});

describe("ToastCard", () => {
  it("shows an always-visible dismiss control for errors", () => {
    const onDismiss = vi.fn();
    render(
      <ToastCard
        tone="danger"
        title="[收件箱] 错误"
        body="invalid inbox JSON"
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId("error-toast")).toBeInTheDocument();
    const close = screen.getByRole("button", { name: "关闭" });
    const name = close.querySelector("[data-icon-name]");
    expect(name).toHaveTextContent("关闭");
    expect(name).toHaveClass("hidden", "group-focus-visible:block");
    expect(close.querySelector("svg")).toHaveClass("group-focus-visible:hidden");
    fireEvent.click(close);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("writes the full body when keyboard focus lands on close or the open region", () => {
    const body =
      "同步失败：IMAP 在读取第 14 封之后超时，服务器把连接关掉了。重试之前先看这一段完整原因，不要只停在前两行。";
    const { rerender } = render(
      <ToastCard tone="danger" title="[收件箱] 错误" body={body} onDismiss={vi.fn()} />,
    );
    const errorCard = screen.getByTestId("error-toast");
    const errorBody = errorCard.querySelector(".line-clamp-2");
    expect(errorBody).toHaveTextContent(body);
    expect(errorBody).toHaveClass(
      "line-clamp-2",
      "group-has-[:focus-visible]:line-clamp-none",
      "group-has-[:focus-visible]:break-words",
    );
    expect(errorBody?.className).not.toContain("group-hover:");
    expect(errorCard).toHaveClass("group");
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();

    rerender(
      <ToastCard tone="insight" title="喝水" body={body} onClick={vi.fn()} onDismiss={vi.fn()} />,
    );
    const notice = screen.getByTestId("notice-toast");
    const open = screen.getByRole("button", { name: /喝水/ });
    const noticeBody = open.querySelector(".line-clamp-2");
    expect(noticeBody).toHaveTextContent(body);
    expect(noticeBody).toHaveClass("line-clamp-2", "group-has-[:focus-visible]:line-clamp-none");
    expect(noticeBody?.className).not.toContain("group-hover:");
    expect(notice).toHaveClass("group");
    expect(open.contains(noticeBody)).toBe(true);
  });

  it("gives a clickable notice the timeline focus ring", () => {
    render(<ToastCard tone="insight" title="待审批" body="需要确认" onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: /待审批/ })).toHaveClass(
      "focus-visible:ring-focus-ring",
    );
  });

  it("opens on Enter or Space without scrolling the page", () => {
    const onClick = vi.fn();
    render(<ToastCard tone="insight" title="喝水" body="该喝了" onClick={onClick} />);
    const region = screen.getByRole("button", { name: /喝水/ });
    expect(fireEvent.keyDown(region, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(region, { key: "Enter" })).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("does not open while an IME composition is in progress", () => {
    const onClick = vi.fn();
    render(<ToastCard tone="insight" title="喝水" onClick={onClick} />);
    const region = screen.getByRole("button", { name: /喝水/ });
    expect(fireEvent.keyDown(region, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(region, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(region, { key: " ", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(region, { key: " ", keyCode: 229 })).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not open again when the key repeats", () => {
    const onClick = vi.fn();
    render(<ToastCard tone="insight" title="喝水" onClick={onClick} />);
    const region = screen.getByRole("button", { name: /喝水/ });
    expect(fireEvent.keyDown(region, { key: "Enter", repeat: true })).toBe(false);
    expect(fireEvent.keyDown(region, { key: " ", repeat: true })).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ignores keys other than Enter and Space", () => {
    const onClick = vi.fn();
    render(<ToastCard tone="insight" title="喝水" onClick={onClick} />);
    expect(fireEvent.keyDown(screen.getByRole("button", { name: /喝水/ }), { key: "a" })).toBe(
      true,
    );
    expect(onClick).not.toHaveBeenCalled();
  });
});
