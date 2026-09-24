import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import TodayActions from "./TodayActions";
import type { TodayBuckets } from "./todayBuckets";

const focusRing = "focus-visible:ring-focus-ring";

function buckets(partial: Partial<TodayBuckets> = {}): TodayBuckets {
  return {
    decide: [],
    do: [],
    handled: [],
    leftoverGoalCount: 0,
    reminders: [],
    ...partial,
  };
}

describe("TodayActions", () => {
  it("opens decide, do, and handled rows as links", () => {
    renderWithRouter(
      <TodayActions
        buckets={buckets({
          decide: [
            { kind: "approval", id: "ap-1", title: "write_file", href: "/approvals" },
            {
              kind: "memory",
              id: "proposed",
              title: "2 条记忆待确认",
              href: "/memories?tab=review",
              count: 2,
            },
            { kind: "email", id: "e1", title: "请回复", href: "/inbox", category: "important" },
          ],
          do: [
            {
              kind: "goal",
              id: "g1",
              title: "交报告",
              href: "/goals/g1",
              reason: "deadline",
              progress: 0.2,
            },
          ],
          handled: [{ kind: "inbox_digest", id: "n1", title: "收件箱摘要", href: "/inbox" }],
          leftoverGoalCount: 2,
        })}
      />,
    );

    const approval = screen.getByRole("link", { name: "write_file" });
    expect(approval).toHaveAttribute("href", "/approvals");
    expect(approval).toHaveClass(focusRing);
    expect(screen.getByRole("link", { name: "2 条记忆待确认" })).toHaveAttribute(
      "href",
      "/memories?tab=review",
    );
    expect(screen.getByRole("link", { name: "请回复" })).toHaveAttribute("href", "/inbox");
    const goal = screen.getByRole("link", { name: /交报告/ });
    expect(goal).toHaveAttribute("href", "/goals/g1");
    expect(goal).toHaveClass(focusRing);
    expect(screen.getByRole("link", { name: "收件箱摘要" })).toHaveAttribute("href", "/inbox");
    const more = screen.getByRole("link", { name: /还有 2 个目标/ });
    expect(more).toHaveAttribute("href", "/goals");
    expect(more).toHaveClass(focusRing);
  });

  it("links leftover goals from the empty day", () => {
    renderWithRouter(<TodayActions buckets={buckets({ leftoverGoalCount: 3 })} />);
    const link = screen.getByRole("link", { name: /查看全部目标/ });
    expect(link).toHaveAttribute("href", "/goals");
    expect(link).toHaveClass(focusRing);
    expect(screen.queryByRole("button", { name: /查看全部目标/ })).not.toBeInTheDocument();
  });
});
