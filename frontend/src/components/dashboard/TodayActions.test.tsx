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

  it("writes the full column title when the row is keyboard focused", () => {
    const decide = "批准把这份还没发出的周报写进共享目录，并记下这次为什么要改截止日";
    const doing = "在周五前把实验图表、结论和还没回的审稿意见收成可以勾掉的清单";
    const handled = "晨报已经把昨天的三封重要邮件和两个停滞目标写进今天的安排";
    renderWithRouter(
      <TodayActions
        buckets={buckets({
          decide: [{ kind: "approval", id: "ap-long", title: decide, href: "/approvals" }],
          do: [
            {
              kind: "goal",
              id: "g-long",
              title: doing,
              href: "/goals/g-long",
              reason: "deadline",
              progress: 0.2,
            },
          ],
          handled: [{ kind: "inbox_digest", id: "n-long", title: handled, href: "/inbox" }],
        })}
      />,
    );

    for (const title of [decide, doing, handled]) {
      const row = screen.getByRole("link", { name: new RegExp(title) });
      const line = row.querySelector(".truncate");
      expect(line).toHaveTextContent(title);
      expect(line).toHaveClass(
        "truncate",
        "group-focus-visible:overflow-visible",
        "group-focus-visible:whitespace-normal",
        "group-focus-visible:text-clip",
      );
      expect(line?.className).not.toContain("group-hover:");
      expect(row).toHaveClass("group");
    }
  });

  it("links leftover goals from the empty day", () => {
    renderWithRouter(<TodayActions buckets={buckets({ leftoverGoalCount: 3 })} />);
    const link = screen.getByRole("link", { name: /查看全部目标/ });
    expect(link).toHaveAttribute("href", "/goals");
    expect(link).toHaveClass(focusRing);
    expect(screen.queryByRole("button", { name: /查看全部目标/ })).not.toBeInTheDocument();
  });
});
