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
});
