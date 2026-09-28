import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LiveStatus from "./LiveStatus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("mounts an empty region before announcing and keeps it for repeated messages", () => {
  vi.useFakeTimers();
  const view = render(
    <StrictMode>
      <LiveStatus message="已完成" announcementId={1} />
    </StrictMode>,
  );
  const region = screen.getByRole("status");
  expect(region).toBeEmptyDOMElement();
  expect(region).toHaveAttribute("aria-atomic", "true");
  act(() => vi.advanceTimersByTime(100));
  expect(region).toHaveTextContent("已完成");
  view.rerender(
    <StrictMode>
      <LiveStatus message="已完成" announcementId={2} />
    </StrictMode>,
  );
  expect(screen.getByRole("status")).toBe(region);
  expect(region).toBeEmptyDOMElement();
  act(() => vi.advanceTimersByTime(100));
  expect(region).toHaveTextContent("已完成");
  view.rerender(
    <StrictMode>
      <LiveStatus />
    </StrictMode>,
  );
  expect(screen.getByRole("status")).toBe(region);
  expect(region).toBeEmptyDOMElement();
});

it("cancels obsolete announcements and pending timers on unmount", () => {
  vi.useFakeTimers();
  const view = render(<LiveStatus message="旧消息" />);
  const region = screen.getByRole("status");
  act(() => vi.advanceTimersByTime(50));
  view.rerender(<LiveStatus message="新消息" />);
  act(() => vi.advanceTimersByTime(50));
  expect(region).toBeEmptyDOMElement();
  act(() => vi.advanceTimersByTime(50));
  expect(region).toHaveTextContent("新消息");
  view.rerender(<LiveStatus message="即将卸载" />);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
