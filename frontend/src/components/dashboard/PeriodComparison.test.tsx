import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import type { PeriodComparison } from "../../api/system";
import { formatCountDelta, formatRateDelta, PeriodComparisonView } from "./PeriodComparison";

const SAMPLE: PeriodComparison = {
  days: 7,
  current: { start: "2026-09-15T00:00:00+00:00", end: "2026-09-22T00:00:00+00:00" },
  previous: { start: "2026-09-08T00:00:00+00:00", end: "2026-09-15T00:00:00+00:00" },
  signals: {
    goals_completed: { current: 2, previous: 1, delta: 1 },
    tasks_completed: { current: 1, previous: 1, delta: 0 },
    work_completed_untyped: { current: 0, previous: 0, delta: 0 },
    inbox_recorded: { current: 4, previous: 6, delta: -2 },
    adoption_decided: { current: 3, previous: 2, delta: 1 },
    adoption_rate: { current: 2 / 3, previous: 0.5, delta: 2 / 3 - 0.5 },
  },
  capped: false,
};

describe("formatCountDelta", () => {
  it("marks direction without hiding a flat week", () => {
    expect(formatCountDelta(2)).toBe("+2");
    expect(formatCountDelta(-1)).toBe("-1");
    expect(formatCountDelta(0)).toBe("持平");
  });
});

describe("formatRateDelta", () => {
  it("uses percentage points and leaves a missing side blank", () => {
    expect(formatRateDelta(0.17)).toBe("+17 个百分点");
    expect(formatRateDelta(-0.5)).toBe("-50 个百分点");
    expect(formatRateDelta(0)).toBe("持平");
    expect(formatRateDelta(null)).toBe("—");
  });
});

describe("PeriodComparisonView", () => {
  it("shows the two windows and hides unknown types when both are zero", () => {
    renderWithRouter(<PeriodComparisonView comparison={SAMPLE} />);
    const card = screen.getByTestId("period-comparison");
    expect(card).toHaveTextContent("近 7 日 vs 前 7 日");
    expect(card).toHaveTextContent("完成目标");
    expect(card).toHaveTextContent("+1");
    expect(card).toHaveTextContent("完成任务");
    expect(card).toHaveTextContent("持平");
    expect(card).toHaveTextContent("新邮件");
    expect(card).toHaveTextContent("-2");
    expect(card).toHaveTextContent("67%");
    expect(card).toHaveTextContent("+17 个百分点");
    expect(card).toHaveTextContent("前 7 日采纳 50%");
    expect(card).not.toHaveTextContent("类型未知");
  });

  it("shows unknown completions and the cap warning", () => {
    renderWithRouter(
      <PeriodComparisonView
        comparison={{
          ...SAMPLE,
          capped: true,
          signals: {
            ...SAMPLE.signals,
            work_completed_untyped: { current: 1, previous: 0, delta: 1 },
          },
        }}
      />,
    );
    const card = screen.getByTestId("period-comparison");
    expect(card).toHaveTextContent("已完成（类型未知）");
    expect(card).toHaveTextContent("数字可能不完整");
  });

  it("explains a fully quiet pair of weeks", () => {
    const zero = { current: 0, previous: 0, delta: 0 };
    renderWithRouter(
      <PeriodComparisonView
        comparison={{
          ...SAMPLE,
          signals: {
            goals_completed: zero,
            tasks_completed: zero,
            work_completed_untyped: zero,
            inbox_recorded: zero,
            adoption_decided: zero,
            adoption_rate: { current: null, previous: null, delta: null },
          },
        }}
      />,
    );
    expect(screen.getByTestId("period-comparison")).toHaveTextContent(
      "都还没有完成目标、任务、新邮件或拍板记录",
    );
  });
});
