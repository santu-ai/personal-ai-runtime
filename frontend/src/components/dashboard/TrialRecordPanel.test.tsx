import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import type { DeliveryMetrics } from "../../api/types";
import {
  TrialRecordView,
  downloadTrialRecord,
  trialCostLabel,
  trialRecordDocument,
  trialSuccessLabel,
  trialTimeSavedLabel,
} from "./TrialRecordPanel";

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
    expect(record).toHaveTextContent("核对是否变短");
    expect(record).toHaveTextContent("次数不够，还看不出变快");
    expect(record).toHaveTextContent("估计省下的时间（自报）");
    expect(record).toHaveTextContent("尚无自报基线");
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
    expect(trialCostLabel({ reviewed_tasks: 0 } as DeliveryMetrics)).toBe("尚无被接受的交付");
  });

  it("exports the four figures the panel is showing", async () => {
    const doc = trialRecordDocument(metrics(), "2026-10-10T03:00:00.000Z");
    expect(doc.kind).toBe("trial-record");
    expect(doc.window_days).toBe(14);
    expect(doc.display.success_rate).toBe("50%（2/4）");
    expect(doc.display.first_version_acceptance_rate).toBe("25%（1/4）");
    expect(doc.display.average_review_latency_hours).toBe("1.5 小时");
    expect(doc.display.review_time_trend).toBe("次数不够，还看不出变快");
    expect(doc.display.self_reported_time_saved).toBe("尚无自报基线");
    expect(doc.display.cost_per_accepted_delivery).toBe("$0.1250");
    expect(doc.how_to_read.average_review_latency_hours).toContain("核对");
    expect(doc.how_to_read.review_time_trend).toContain("后半段");
    expect(doc.how_to_read.self_reported_time_saved).toContain("自报");
    expect(doc.reviews).toEqual([]);

    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:trial");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    renderWithRouter(<TrialRecordView metrics={metrics()} />);
    fireEvent.click(screen.getByRole("button", { name: "导出试用记录" }));
    expect(screen.getByText(/下载一份 JSON/)).toBeInTheDocument();
    downloadTrialRecord(metrics(), "2026-10-10T03:00:00.000Z");
    const blob = create.mock.calls[create.mock.calls.length - 1]?.[0] as Blob;
    expect(await blob.text()).toContain("50%（2/4）");
    expect(downloads[0]).toMatch(/^trial-record-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[downloads.length - 1]).toBe("trial-record-2026-10-10.json");
    expect(revoke).toHaveBeenCalled();
    create.mockRestore();
    revoke.mockRestore();
    click.mockRestore();
  });

  it("labels estimated time saved as self-reported", () => {
    const withGuess = metrics({
      self_reported_time_saved: {
        basis: "self_reported",
        count: 2,
        manual_minutes: 90,
        assisted_minutes: 50.2,
        estimated_saved_minutes: 39.8,
      },
    });
    expect(trialTimeSavedLabel(withGuess)).toBe(
      "自报约省 40 分钟（2 次：手工 90 分钟，核对 50 分钟）",
    );
    const slower = metrics({
      self_reported_time_saved: {
        basis: "self_reported",
        count: 1,
        manual_minutes: 10,
        assisted_minutes: 30,
        estimated_saved_minutes: -20,
      },
    });
    expect(trialTimeSavedLabel(slower)).toContain("多花了 20 分钟");
    const doc = trialRecordDocument(withGuess, "2026-10-11T00:00:00.000Z");
    expect(doc.self_reported_time_saved).toEqual(withGuess.self_reported_time_saved);
    expect(doc.display.self_reported_time_saved).toContain("自报");
  });
});
