import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getDeliveryMetrics, type DeliveryMetrics } from "../../api/client";
import LoadErrorNotice, { queryErrorMessage } from "../ui/LoadErrorNotice";

export const TRIAL_WINDOW_DAYS = 14;

export function trialSuccessLabel(metrics: DeliveryMetrics): string {
  const reviewed = metrics.reviewed_tasks;
  const rate =
    metrics.success_rate !== undefined
      ? metrics.success_rate
      : reviewed > 0
        ? metrics.accepted_tasks / reviewed
        : null;
  if (rate == null || reviewed <= 0) return "尚无验收";
  const percent = Math.round(rate * 100);
  return `${percent}%（${metrics.accepted_tasks}/${reviewed}）`;
}

export function trialFirstVersionLabel(metrics: DeliveryMetrics): string {
  if (metrics.first_version_acceptance_rate == null || metrics.first_reviewed_tasks <= 0) {
    return "尚无首次评审";
  }
  const percent = Math.round(metrics.first_version_acceptance_rate * 100);
  return `${percent}%（${metrics.first_version_accepted_tasks}/${metrics.first_reviewed_tasks}）`;
}

export function trialReviewTimeLabel(metrics: DeliveryMetrics): string {
  if (metrics.average_review_latency_hours == null) return "尚无核对";
  return `${metrics.average_review_latency_hours} 小时`;
}

export function trialCostLabel(metrics: DeliveryMetrics): string {
  const explicit = metrics.cost_per_accepted_delivery;
  let cost: number | "unavailable" | null;
  if (explicit !== undefined) {
    cost = explicit;
  } else if (!metrics.attribution || metrics.attribution.llm_cost === "unavailable") {
    cost = metrics.attribution ? "unavailable" : null;
  } else if (metrics.accepted_tasks > 0) {
    cost = metrics.attribution.llm_cost / metrics.accepted_tasks;
  } else {
    cost = null;
  }
  if (cost === "unavailable") return "未分开计";
  if (cost == null) return "尚无被接受的交付";
  return `$${cost.toFixed(4)}`;
}

function TrialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-fg-secondary">{label}</span>
      <span className="text-fg-primary">{value}</span>
    </div>
  );
}

export function TrialRecordView({ metrics }: { metrics: DeliveryMetrics }) {
  return (
    <section
      aria-label="14 天试用"
      data-testid="trial-record"
      className="mb-5 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3.5 shadow-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <ClipboardList size={16} className="text-fg-tertiary" />
        <h3 className="text-sm font-semibold tracking-tight text-fg-primary">14 天试用</h3>
      </div>
      <div className="space-y-1">
        <TrialRow label="成功率" value={trialSuccessLabel(metrics)} />
        <TrialRow label="第一版验收率" value={trialFirstVersionLabel(metrics)} />
        <TrialRow label="人工核对时间" value={trialReviewTimeLabel(metrics)} />
        <TrialRow label="每份被接受交付的成本" value={trialCostLabel(metrics)} />
      </div>
      {metrics.capped ? (
        <p className="mt-2 text-xs text-fg-tertiary">这段时间事件较多，数字可能不完整</p>
      ) : null}
    </section>
  );
}

export default function TrialRecordPanel() {
  const query = useQuery({
    queryKey: ["work-items", "delivery-metrics", TRIAL_WINDOW_DAYS],
    queryFn: () => getDeliveryMetrics(TRIAL_WINDOW_DAYS),
    staleTime: 30_000,
    retry: 1,
  });

  if (query.isError) {
    return (
      <div className="mb-5">
        <LoadErrorNotice
          message={queryErrorMessage(query.error, "试用记录暂时读不到")}
          busy={query.isFetching}
          onRetry={() => {
            if (query.isFetching) return;
            void query.refetch();
          }}
          testId="trial-record-load-error"
        />
      </div>
    );
  }

  if (!query.data) {
    return (
      <section
        aria-label="14 天试用"
        className="mb-5 rounded-lg border border-border-subtle px-4 py-3 text-xs text-fg-tertiary"
        data-testid="trial-record-loading"
      >
        加载试用记录…
      </section>
    );
  }

  return <TrialRecordView metrics={query.data} />;
}
