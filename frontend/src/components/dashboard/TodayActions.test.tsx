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
    expect(screen.getByRole("link", { name: "请回复重要" })).toHaveAttribute("href", "/inbox");
    const goal = screen.getByRole("link", { name: /交报告/ });
    expect(goal).toHaveAttribute("href", "/goals/g1");
    expect(goal).toHaveClass(focusRing);
    expect(screen.getByRole("link", { name: "收件箱摘要" })).toHaveAttribute("href", "/inbox");
    const more = screen.getByRole("link", { name: /还有 2 个目标/ });
    expect(more).toHaveAttribute("href", "/goals");
    expect(more).toHaveClass(focusRing);
  });

  it("names decide icons for the keyboard and writes the mail category", () => {
    renderWithRouter(
      <TodayActions
        buckets={buckets({
          decide: [
            { kind: "approval", id: "ap-1", title: "写入文件", href: "/approvals" },
            {
              kind: "memory",
              id: "proposed",
              title: "2 条记忆待确认",
              href: "/memories?tab=review",
              count: 2,
            },
            { kind: "email", id: "e-imp", title: "合同", href: "/inbox", category: "important" },
            { kind: "email", id: "e-act", title: "跟进", href: "/inbox", category: "actionable" },
            { kind: "email", id: "e-blank", title: "无分类", href: "/inbox", category: "  " },
          ],
        })}
      />,
    );

    const approval = screen.getByRole("link", { name: "写入文件" });
    expect(approval.querySelector("svg")).toHaveClass("group-focus-visible:hidden");
    const approvalName = approval.querySelector("[data-icon-name]");
    expect(approvalName).toHaveTextContent("审批");
    expect(approvalName).toHaveAttribute("aria-hidden", "true");
    expect(approvalName).toHaveClass("hidden", "group-focus-visible:inline");

    expect(
      screen.getByRole("link", { name: "2 条记忆待确认" }).querySelector("[data-icon-name]"),
    ).toHaveTextContent("记忆");

    const important = screen.getByRole("link", { name: "合同重要" });
    expect(important.querySelector("[data-icon-name]")).toHaveTextContent("邮件");
    expect(important).toHaveTextContent("重要");
    expect(screen.getByRole("link", { name: "跟进需跟进" })).toHaveTextContent("需跟进");

    const blank = screen.getByRole("link", { name: "无分类" });
    expect(blank).not.toHaveTextContent("重要");
    expect(blank).not.toHaveTextContent("需跟进");
  });

  it("names do and handled icons for the keyboard", () => {
    renderWithRouter(
      <TodayActions
        buckets={buckets({
          do: [
            {
              kind: "goal",
              id: "g-due",
              title: "交报告",
              href: "/goals/g-due",
              reason: "deadline",
              progress: 0.2,
            },
            {
              kind: "goal",
              id: "g-stale",
              title: "学 Rust",
              href: "/goals/g-stale",
              reason: "stagnant",
              progress: 0.1,
            },
          ],
          handled: [
            { kind: "morning_brief", id: "mb", title: "早安简报", href: "/dashboard" },
            { kind: "inbox_digest", id: "dg", title: "收件箱摘要", href: "/inbox" },
            { kind: "goal_event", id: "gp", title: "目标有进展", href: "/goals/g1" },
            {
              kind: "ignored_mail",
              id: "ignored",
              title: "2 封可忽略邮件",
              href: "/inbox",
              count: 2,
            },
          ],
        })}
      />,
    );

    function expectKind(name: string | RegExp, kind: string) {
      const row = screen.getByRole("link", { name });
      const icon = row.querySelector("svg");
      expect(icon).toHaveClass("group-focus-visible:hidden");
      expect(icon?.getAttribute("class")).not.toContain("group-hover:");
      const label = row.querySelector("[data-icon-name]");
      expect(label).toHaveTextContent(kind);
      expect(label).toHaveAttribute("aria-hidden", "true");
      expect(label).toHaveClass("hidden", "group-focus-visible:inline");
      expect(label?.className).not.toContain("group-hover:");
      return row;
    }

    const due = expectKind(/交报告/, "目标");
    expect(due).toHaveTextContent("截止将近");
    const stale = expectKind(/学 Rust/, "目标");
    expect(stale).toHaveTextContent("已停滞");
    expectKind("早安简报", "晨报");
    expectKind("收件箱摘要", "摘要");
    expectKind("目标有进展", "目标");
    expectKind("2 封可忽略邮件", "邮件");
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
