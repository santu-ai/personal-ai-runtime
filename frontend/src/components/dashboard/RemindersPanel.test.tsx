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
  });
});
