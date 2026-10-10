import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getDeliveryMetrics, type DeliveryMetrics } from "../../api/client";
import Button from "../ui/Button";
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

export function trialReviewTrendLabel(metrics: DeliveryMetrics): string {
  if (metrics.average_review_latency_hours == null) return "尚无核对";
  const trend = metrics.review_time_trend;
  const earlier = trend?.earlier_half_hours;
  const later = trend?.later_half_hours;
  if (
    !trend ||
    trend.earlier_half_count <= 0 ||
    trend.later_half_count <= 0 ||
    earlier == null ||
    later == null
  ) {
    return "次数不够，还看不出变快";
  }
  return `前半段 ${earlier} 小时（${trend.earlier_half_count} 次），后半段 ${later} 小时（${trend.later_half_count} 次）`;
}

export function trialTimeSavedLabel(metrics: DeliveryMetrics): string {
  const saved = metrics.self_reported_time_saved;
  if (
    !saved ||
    saved.count <= 0 ||
    saved.estimated_saved_minutes == null ||
    saved.manual_minutes == null ||
    saved.assisted_minutes == null
  ) {
    return "尚无自报基线";
  }
  const delta = Math.round(saved.estimated_saved_minutes);
  const phrase =
    delta >= 0 ? `自报约省 ${delta} 分钟` : `自报比手工估计多花了 ${Math.abs(delta)} 分钟`;
  return `${phrase}（${saved.count} 次：手工 ${saved.manual_minutes} 分钟，核对 ${Math.round(saved.assisted_minutes)} 分钟）`;
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

export function trialRecordDocument(metrics: DeliveryMetrics, exportedAt: string) {
  return {
    kind: "trial-record",
    window_days: metrics.window_days ?? TRIAL_WINDOW_DAYS,
    exported_at: exportedAt,
    how_to_read: {
      success_rate: "窗口内已接受的简报除以有过评审的简报。没有评审时页面写「尚无验收」。",
      first_version_acceptance_rate:
        "窗口内首次评审就接受第一版的比例。没有首次评审时页面写「尚无首次评审」。",
      average_review_latency_hours:
        "从交付到首次评审的平均小时数，用来看核对花了多少时间。没有核对时页面写「尚无核对」。",
      review_time_trend:
        "把窗口对半切开。前半段和后半段各至少有一次核对时，比较两段的平均小时。后半段更短，说明这 14 天里核对变快了。这不是和不用助手相比省下的时间。只有一个总平均数看不出有没有降下来。每一次核对的起止时间在 reviews 里。次数只落在半段时页面写「次数不够，还看不出变快」。",
      self_reported_time_saved:
        "验收时可以选填「不用助手大概要多少分钟」。只统计填了的验收：用这些自报分钟减去同一次从交付到验收的分钟，得到估计省下的时间。没填的不参与。这是自报，不是测出来的对照。没有填写时页面写「尚无自报基线」。",
      cost_per_accepted_delivery:
        "已归因模型费用除以被接受的份数。没有被接受的交付时页面写「尚无被接受的交付」；费用不是数字时写「未分开计」。",
    },
    display: {
      success_rate: trialSuccessLabel(metrics),
      first_version_acceptance_rate: trialFirstVersionLabel(metrics),
      average_review_latency_hours: trialReviewTimeLabel(metrics),
      review_time_trend: trialReviewTrendLabel(metrics),
      self_reported_time_saved: trialTimeSavedLabel(metrics),
      cost_per_accepted_delivery: trialCostLabel(metrics),
    },
    review_time_trend: metrics.review_time_trend ?? null,
    self_reported_time_saved: metrics.self_reported_time_saved ?? null,
    reviews: metrics.reviews ?? [],
    metrics,
  };
}

export function downloadTrialRecord(
  metrics: DeliveryMetrics,
  exportedAt = new Date().toISOString(),
): void {
  const body = JSON.stringify(trialRecordDocument(metrics, exportedAt), null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const day = /^\d{4}-\d{2}-\d{2}/.test(exportedAt) ? exportedAt.slice(0, 10) : "record";
  link.href = url;
  link.download = `trial-record-${day}.json`;
  link.click();
  URL.revokeObjectURL(url);
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
        <TrialRow label="核对是否变短" value={trialReviewTrendLabel(metrics)} />
        <TrialRow label="估计省下的时间（自报）" value={trialTimeSavedLabel(metrics)} />
        <TrialRow label="每份被接受交付的成本" value={trialCostLabel(metrics)} />
      </div>
      <div className="mt-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="trial-record-export"
          onClick={() => downloadTrialRecord(metrics)}
        >
          导出试用记录
        </Button>
        <p className="mt-2 text-xs text-fg-tertiary">
          下载一份 JSON，文件名是 trial-record-加当天日期。上面六行和每一次核对都会写进去。
        </p>
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
