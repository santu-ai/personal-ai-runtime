import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import type { RerunnableBrief, TimerStatusItem } from "../../api/types";
import TimerBriefPanel from "./TimerBriefPanel";

const reveal = [
  "truncate",
  "group-focus-visible:overflow-visible",
  "group-focus-visible:whitespace-normal",
  "group-focus-visible:text-clip",
  "group-focus-visible:break-words",
];

function timer(partial: Partial<TimerStatusItem> & Pick<TimerStatusItem, "id">): TimerStatusItem {
  return {
    handler_name: "morning_brief",
    schedule_type: "cron",
    fire_at: "2026-09-24T00:00:00Z",
    work_id: null,
    ...partial,
  };
}

function renderPanel(
  timers: TimerStatusItem[],
  briefs: RerunnableBrief[] = [],
  activeTimers = timers.length,
) {
  return renderWithRouter(
    <TimerBriefPanel timers={timers} activeTimers={activeTimers} briefs={briefs} />,
  );
}

describe("TimerBriefPanel", () => {
  it("writes the full schedule when a task link is keyboard focused", () => {
    const fireAt = "2026-09-24T08:30:00+08:00-a-long-fire-time-that-used-to-stay-truncated";
    renderPanel([
      timer({
        id: "t-work",
        handler_name: "custom_handler_with_a_very_long_name_that_used_to_stay_truncated",
        schedule_type: "interval",
        fire_at: fireAt,
        work_id: "brief 9",
      }),
    ]);

    const link = screen.getByRole("link", {
      name: /custom_handler_with_a_very_long_name_that_used_to_stay_truncated/,
    });
    expect(link).toHaveAttribute("href", "/tasks/brief%209");
    expect(link).toHaveTextContent(fireAt);
    expect(link).toHaveTextContent("interval");
    expect(link).toHaveClass("group", "focus-visible:ring-focus-ring");
    const line = link.querySelector(".truncate");
    expect(line).toHaveTextContent(fireAt);
    expect(line).toHaveClass(...reveal);
    expect(line?.className).not.toContain("group-hover:");
    expect(link).not.toHaveAttribute("title");
  });

  it("lets keyboard focus reveal a schedule that has no task link", () => {
    const name = "projection_job_with_a_very_long_handler_name_that_used_to_stay_one_line";
    const fireAt = "2099-01-01T00:00:00.000000Z-and-then-some-extra-clock-text";
    renderPanel(
      [
        timer({ id: "t-plain", handler_name: name, schedule_type: "once", fire_at: fireAt }),
        timer({
          id: "t-blank",
          handler_name: "reminder",
          schedule_type: "once",
          fire_at: "2026-09-24T01:00:00Z",
          work_id: "   ",
        }),
      ],
      [
        {
          work_id: "brief_9",
          title: "项目 A 简报很长也不会被截成一行",
          version: 2,
          delivery_id: "d2",
        },
      ],
    );

    const plain = screen.getByText(new RegExp(name)).parentElement;
    expect(plain).toHaveAttribute("tabindex", "0");
    expect(plain).toHaveClass("group", "focus-visible:ring-focus-ring");
    expect(plain?.querySelector(".truncate")).toHaveClass(...reveal);
    expect(plain?.querySelector(".truncate")?.className).not.toContain("group-hover:");
    expect(plain).toHaveTextContent(fireAt);
    expect(plain?.closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(name) })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(name) })).not.toBeInTheDocument();

    expect(fireEvent.keyDown(plain!, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(plain!, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(plain!, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(plain!, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(plain!, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(plain!, { key: " ", keyCode: 229 })).toBe(true);

    const blank = screen.getByText(/提醒 · 一次/).parentElement;
    expect(blank).toHaveAttribute("tabindex", "0");
    expect(blank?.closest("a")).toBeNull();

    const brief = screen.getByRole("link", { name: /项目 A 简报很长也不会被截成一行 · 当前 v2/ });
    expect(brief).toHaveAttribute("href", "/tasks/brief_9");
    expect(brief.className).not.toContain("truncate");
    expect(brief.querySelector(".truncate")).toBeNull();
  });
});
