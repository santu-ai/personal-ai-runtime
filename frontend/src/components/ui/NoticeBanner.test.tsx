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
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onDismiss).toHaveBeenCalledOnce();
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
    expect(fireEvent.keyDown(region, { key: " ", isComposing: true })).toBe(true);
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
