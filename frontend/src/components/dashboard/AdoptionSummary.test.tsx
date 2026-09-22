import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import { AdoptionSummaryView, formatAdoptionRate } from "./AdoptionSummary";
import type { AdoptionSummary } from "../../api/telemetry";

const SAMPLE: AdoptionSummary = {
  days: 7,
  suggestions: {
    days: 7,
    adopted: 3,
    rejected: 1,
    expired: 2,
    auto_allowed: 4,
    decided: 4,
    adoption_rate: 0.75,
  },
  memories: {
    ratified: 1,
    rejected: 1,
    auto_expired: 0,
    proposed_open: 2,
    decided: 2,
    conversion_rate: 0.5,
  },
  adopted: 4,
  rejected: 2,
  decided: 6,
  adoption_rate: 4 / 6,
};

describe("AdoptionSummaryView", () => {
  it("formats a missing rate as a dash", () => {
    expect(formatAdoptionRate(null)).toBe("—");
    expect(formatAdoptionRate(0.8)).toBe("80%");
  });

  it("shows the combined rate and both loops", () => {
    renderWithRouter(<AdoptionSummaryView adoption={SAMPLE} />);
    expect(screen.getByTestId("adoption-summary")).toHaveTextContent("近 7 日 67%");
    expect(screen.getByText(/工具建议 3 采纳 \/ 1 拒绝/)).toBeInTheDocument();
    expect(screen.getByText(/记忆 1 确认 \/ 1 拒绝/)).toBeInTheDocument();
  });

  it("explains an empty decision window", () => {
    renderWithRouter(
      <AdoptionSummaryView
        adoption={{
          ...SAMPLE,
          adopted: 0,
          rejected: 0,
          decided: 0,
          adoption_rate: null,
        }}
      />,
    );
    expect(screen.getByText("还没有你拍板的工具建议或记忆")).toBeInTheDocument();
  });

  it("opens the trust tab when the card is clicked", () => {
    const onOpen = vi.fn();
    renderWithRouter(<AdoptionSummaryView adoption={SAMPLE} onOpen={onOpen} />);
    screen.getByTestId("adoption-summary").click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
