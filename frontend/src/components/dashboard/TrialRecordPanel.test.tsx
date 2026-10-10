import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import type { DeliveryMetrics } from "../../api/types";
import { TrialRecordView, trialCostLabel, trialSuccessLabel } from "./TrialRecordPanel";

function metrics(partial: Partial<DeliveryMetrics> = {}): DeliveryMetrics {
  return {
    window_days: 14,
    reviewed_tasks: 4,
    accepted_tasks: 2,
    success_rate: 0.5,
    first_reviewed_tasks: 4,
    first_version_accepted_tasks: 1,
    first_version_acceptance_rate: 0.25,
    rework_count: 1,
    adopted_action_count: 0,
    average_review_latency_hours: 1.5,
    cost_per_accepted_delivery: 0.125,
    attribution: {
      approval_interventions: 0,
      recovery_interventions: 0,
      llm_cost: 0.25,
      unattributed_project_brief_calls: 0,
      unattributed_project_brief_cost: 0,
    },
    capped: false,
    cap_limit: 5000,
    items: [],
    ...partial,
  };
}

describe("TrialRecordPanel", () => {
  it("writes the four trial figures", () => {
    renderWithRouter(<TrialRecordView metrics={metrics()} />);
    const record = screen.getByTestId("trial-record");
    expect(record).toHaveTextContent("成功率");
    expect(record).toHaveTextContent("50%（2/4）");
    expect(record).toHaveTextContent("第一版验收率");
    expect(record).toHaveTextContent("25%（1/4）");
    expect(record).toHaveTextContent("人工核对时间");
    expect(record).toHaveTextContent("1.5 小时");
    expect(record).toHaveTextContent("每份被接受交付的成本");
    expect(record).toHaveTextContent("$0.1250");
  });

  it("uses empty wording when the window has no reviews", () => {
    const empty = metrics({
      reviewed_tasks: 0,
      accepted_tasks: 0,
      success_rate: null,
      first_reviewed_tasks: 0,
      first_version_accepted_tasks: 0,
      first_version_acceptance_rate: null,
      average_review_latency_hours: null,
      cost_per_accepted_delivery: null,
    });
    expect(trialSuccessLabel(empty)).toBe("尚无验收");
    expect(trialCostLabel(empty)).toBe("尚无被接受的交付");
    renderWithRouter(<TrialRecordView metrics={empty} />);
    expect(screen.getByTestId("trial-record")).toHaveTextContent("尚无首次评审");
    expect(screen.getByTestId("trial-record")).toHaveTextContent("尚无核对");
  });

  it("says the per-delivery cost is not separated when the read is unavailable", () => {
    expect(trialCostLabel(metrics({ cost_per_accepted_delivery: "unavailable" }))).toBe("未分开计");
  });
});
