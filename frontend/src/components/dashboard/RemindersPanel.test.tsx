import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import RemindersPanel from "./RemindersPanel";

describe("RemindersPanel", () => {
  it("writes the full reminder body when the row is keyboard focused", () => {
    const content =
      "[[related:work_1]] 这份提醒要把昨天没做完的实验、还没回的邮件和周五的截止写完整，键盘落到这一行时不再只留两行。";
    renderWithRouter(
      <RemindersPanel
        notifications={[
          {
            id: "n-long",
            type: "reminder",
            title: "周五之前",
            content,
            created_at: "2026-08-17T10:00:00Z",
            read: 0,
          },
        ]}
        onNotificationClick={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /周五之前/ });
    const body = row.querySelector(".line-clamp-2");
    expect(body).toHaveTextContent(
      "这份提醒要把昨天没做完的实验、还没回的邮件和周五的截止写完整，键盘落到这一行时不再只留两行。",
    );
    expect(body).not.toHaveTextContent("[[related:");
    expect(body).toHaveClass("line-clamp-2", "group-focus-visible:line-clamp-none");
    expect(body?.className).not.toContain("group-hover:");
    expect(row).toHaveClass("group");
    expect(row).toHaveAttribute(
      "aria-label",
      "未读 周五之前 这份提醒要把昨天没做完的实验、还没回的邮件和周五的截止写完整，键盘落到这一行时不再只留两行。",
    );
    expect(row.getAttribute("aria-label")).not.toContain("[[related:");
    expect(row.textContent).not.toContain("未读");
  });

  it("names an unread reminder and a read one without the type", () => {
    renderWithRouter(
      <RemindersPanel
        notifications={[
          {
            id: "n-unread",
            type: "reminder",
            title: "  前  后  ",
            content: " \n 正文 \n ",
            created_at: "2026-08-17T10:00:00Z",
            read: 0,
          },
          {
            id: "n-read",
            type: "goal_deadline",
            title: "  前  后  ",
            content: " \n 正文 \n ",
            created_at: "2026-08-17T10:00:00Z",
            read: 1,
          },
          {
            id: "n-blank",
            type: "reminder",
            title: "   ",
            content: "[[related:work_1]]   ",
            created_at: "2026-08-17T10:00:00Z",
          },
        ]}
        onNotificationClick={vi.fn()}
      />,
    );

    const unread = screen.getByRole("button", { name: /未读 前\s+后 正文/ });
    const read = screen.getByRole("button", { name: /已读 前\s+后 正文/ });
    const blank = screen.getByRole("button", { name: "未读" });
    expect(unread).toHaveAttribute("aria-label", "未读 前  后 正文");
    expect(read).toHaveAttribute("aria-label", "已读 前  后 正文");
    expect(unread.getAttribute("aria-label")).not.toContain("reminder");
    expect(unread.getAttribute("aria-label")).not.toContain("n-unread");
    expect(unread.textContent).toContain("前  后");
    expect(unread.textContent).not.toContain("未读");
    expect(read).toHaveClass("opacity-60");
    expect(read.getAttribute("aria-label")).not.toContain("goal_deadline");
    expect(blank).toHaveAttribute("aria-label", "未读");
  });
});
