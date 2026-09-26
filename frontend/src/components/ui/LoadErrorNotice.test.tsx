import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary";
import LoadErrorNotice from "./LoadErrorNotice";

describe("LoadErrorNotice", () => {
  it("keeps 重试 on the button and appends the reason for screen readers", () => {
    const message = "  目标服务不可用  ";
    render(<LoadErrorNotice message={message} busy={false} onRetry={vi.fn()} testId="err" />);
    const button = screen.getByRole("button", { name: "重试：目标服务不可用" });
    expect(button).toHaveTextContent("重试");
    expect(button).not.toHaveTextContent("目标服务不可用");
    expect(screen.getByTestId("err").querySelector("p")).toHaveTextContent(message, {
      normalizeWhitespace: false,
    });
  });

  it("keeps spaces and line breaks in the middle of the reason", () => {
    const message = "左边  中间\n右边";
    render(<LoadErrorNotice message={message} busy={false} onRetry={vi.fn()} testId="err" />);
    expect(screen.getByRole("button", { name: /^重试(：|$)/ })).toHaveAttribute(
      "aria-label",
      "重试：左边  中间\n右边",
    );
  });

  it("stays 重试 when the reason is blank", () => {
    render(<LoadErrorNotice message={"  \n  "} busy={false} onRetry={vi.fn()} testId="err" />);
    const button = screen.getByRole("button", { name: /^重试(：|$)/ });
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).toHaveTextContent("重试");
  });

  it("does not rename the button while the retry is busy", () => {
    render(<LoadErrorNotice message="还在失败" busy onRetry={vi.fn()} testId="err" />);
    const button = screen.getByRole("button", { name: "重试：还在失败" });
    expect(button).toHaveTextContent("重试");
    expect(button).not.toHaveTextContent("重试中");
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("gives two notices different names when the reasons differ", () => {
    render(
      <>
        <LoadErrorNotice message="审批服务不可用" busy={false} onRetry={vi.fn()} testId="a" />
        <LoadErrorNotice message="目标服务不可用" busy={false} onRetry={vi.fn()} testId="b" />
      </>,
    );
    expect(screen.getByRole("button", { name: "重试：审批服务不可用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试：目标服务不可用" })).toBeInTheDocument();
  });

  it("keeps the same name when two notices show the same reason", () => {
    render(
      <>
        <LoadErrorNotice message="通知服务不可用" busy={false} onRetry={vi.fn()} testId="a" />
        <LoadErrorNotice message="通知服务不可用" busy={false} onRetry={vi.fn()} testId="b" />
      </>,
    );
    expect(screen.getAllByRole("button", { name: "重试：通知服务不可用" })).toHaveLength(2);
  });
});

describe("ErrorBoundary retry", () => {
  it("appends the visible error and still shows 重试", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): never {
      throw new Error("  画不出来  ");
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const button = screen.getByRole("button", { name: "重试：画不出来" });
    expect(button).toHaveTextContent("重试");
    expect(document.body.textContent).toContain("  画不出来  ");
    consoleError.mockRestore();
  });
});
