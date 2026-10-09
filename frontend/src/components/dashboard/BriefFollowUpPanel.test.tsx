import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import type { RecoverableBriefFailure, UnreviewedDelivery } from "../../api/types";
import BriefFollowUpPanel from "./BriefFollowUpPanel";

const reveal = [
  "truncate",
  "group-focus-visible:overflow-visible",
  "group-focus-visible:whitespace-normal",
  "group-focus-visible:text-clip",
  "group-focus-visible:break-words",
];

function renderPanel(
  unreviewed: UnreviewedDelivery[] = [],
  failures: RecoverableBriefFailure[] = [],
) {
  return renderWithRouter(<BriefFollowUpPanel unreviewed={unreviewed} failures={failures} />);
}

describe("BriefFollowUpPanel", () => {
  it("stays hidden when nothing is waiting", () => {
    renderPanel();
    expect(screen.queryByTestId("brief-follow-up")).not.toBeInTheDocument();
  });

  it("links an unreviewed brief and a failed brief to the task", () => {
    renderPanel(
      [
        {
          work_id: "brief 1",
          title: "预算简报",
          delivery_id: "d1",
          version: 2,
          summary: "金额互相矛盾",
        },
      ],
      [
        {
          work_id: "brief 2",
          title: "最近邮件简报",
          status: "failed",
          error: "IMAP 登录失败",
        },
      ],
    );
    expect(screen.getByRole("region", { name: "待验收与失败恢复" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "待验收" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "失败恢复" })).toBeInTheDocument();
    const review = screen.getByRole("link", { name: /预算简报 · v2 · 金额互相矛盾/ });
    expect(review).toHaveAttribute("href", "/tasks/brief%201");
    const failed = screen.getByRole("link", { name: /最近邮件简报 · IMAP 登录失败/ });
    expect(failed).toHaveAttribute("href", "/tasks/brief%202");
    expect(screen.getByText("打开这一份任务后可以重新执行。")).toBeInTheDocument();
    for (const token of reveal) {
      expect(review.firstElementChild).toHaveClass(token);
    }
  });

  it("writes 执行失败 when the stored reason is blank", () => {
    renderPanel([], [{ work_id: "brief-3", title: "", status: "running", error: "  " }]);
    const link = screen.getByRole("link", { name: "项目简报 · 执行失败" });
    expect(link).toHaveAttribute("href", "/tasks/brief-3");
  });
});
