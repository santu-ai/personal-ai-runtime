import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import type { ExecutionTrust, ExecutionTrustItem } from "../../api/types";
import ExecutionTrustPanel from "./ExecutionTrustPanel";

function item(
  partial: Partial<ExecutionTrustItem> & Pick<ExecutionTrustItem, "id">,
): ExecutionTrustItem {
  return {
    status: "failed",
    handler_name: "inbox_poll",
    event_type: "InboxPollRequested",
    error: null,
    retry_count: 0,
    dead_letter: false,
    created_at: "2026-08-17T00:00:00Z",
    completed_at: null,
    correlation_id: "",
    ...partial,
  };
}

function trust(partial: Partial<ExecutionTrust>): ExecutionTrust {
  return {
    by_status: {},
    pending_approvals: 0,
    failed: [],
    in_retry: [],
    dead_letter: [],
    dead_letter_count: 0,
    last_completed: null,
    last_failed: null,
    ...partial,
  };
}

const reveal = [
  "truncate",
  "group-focus-visible:overflow-visible",
  "group-focus-visible:whitespace-normal",
  "group-focus-visible:text-clip",
  "group-focus-visible:break-words",
];

describe("ExecutionTrustPanel", () => {
  it("writes the full error when a task link is keyboard focused", () => {
    const error =
      "imap timeout：连接在读完收件箱之前断了，键盘落到这一行时要写出整句，不能只留在悬停提示里";
    renderWithRouter(
      <ExecutionTrustPanel
        trust={trust({
          by_status: { failed: 1 },
          last_failed: item({
            id: "ex-failed",
            error,
            work_id: "task_failed",
          }),
        })}
      />,
    );

    const link = screen.getByRole("link", { name: new RegExp(error) });
    expect(link).toHaveAttribute("href", "/tasks/task_failed");
    expect(link).toHaveAttribute("title", error);
    expect(link).toHaveClass("group", "focus-visible:ring-focus-ring");
    const line = link.querySelector(".truncate");
    expect(line).toHaveTextContent(error);
    expect(line).toHaveClass(...reveal);
    expect(line?.className).not.toContain("group-hover:");
  });

  it("lets keyboard focus reveal an error that has no task link", () => {
    const error = "no owner：这条死信没有任务，整句以前只在悬停提示里";
    renderWithRouter(
      <ExecutionTrustPanel
        trust={trust({
          by_status: { failed: 1, in_retry: 1 },
          dead_letter_count: 1,
          last_failed: item({ id: "ex-plain", error: "handler down" }),
          in_retry: [
            item({
              id: "ex-retry",
              status: "in_retry",
              handler_name: "memory_decay",
              error: null,
              retry_count: 1,
            }),
          ],
          dead_letter: [item({ id: "ex-dead", error, dead_letter: true, retry_count: 3 })],
        })}
      />,
    );

    const linked = screen.queryByRole("link", { name: /handler down/ });
    expect(linked).not.toBeInTheDocument();
    const plain = screen.getByText(/handler down/).parentElement;
    expect(plain).toHaveAttribute("tabindex", "0");
    expect(plain).toHaveAttribute("title", "handler down");
    expect(plain?.querySelector(".truncate")).toHaveClass(...reveal);
    expect(plain?.className).not.toContain("group-hover:");

    expect(fireEvent.keyDown(plain!, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(plain!, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(plain!, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(plain!, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(plain!, { key: "Process" })).toBe(true);

    const dead = screen.getByText(new RegExp(error)).parentElement;
    expect(dead).toHaveAttribute("tabindex", "0");
    expect(dead).toHaveAttribute("title", error);

    const retry = screen.getByText(/重试中 memory_decay/);
    expect(retry).toHaveClass("truncate");
    expect(retry.className).not.toContain("group-focus-visible:");
    expect(retry).not.toHaveAttribute("tabindex");
  });
});
