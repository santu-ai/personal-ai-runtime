import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { getPeriodComparison, type CountSignal, type PeriodComparison } from "../../api/system";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";
import { STATUS_TONE } from "../ui/statusTone";
import { formatAdoptionRate } from "./AdoptionSummary";

export function formatCountDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return "持平";
}

export function formatRateDelta(delta: number | null): string {
  if (delta == null) return "—";
  const points = Math.round(delta * 100);
  if (points > 0) return `+${points} 个百分点`;
  if (points < 0) return `${points} 个百分点`;
  return "持平";
}

function CountRow({ label, signal }: { label: string; signal: CountSignal }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-fg-secondary">{label}</span>
      <span className="text-fg-primary">
        {signal.current}
        <span className="ml-2 text-fg-tertiary">{formatCountDelta(signal.delta)}</span>
      </span>
    </div>
  );
}

export function PeriodComparisonView({ comparison }: { comparison: PeriodComparison }) {
  const tone = STATUS_TONE.neutral;
  const { signals, days } = comparison;
  const showUntyped =
    signals.work_completed_untyped.current > 0 || signals.work_completed_untyped.previous > 0;
  const quiet =
    signals.goals_completed.current === 0 &&
    signals.goals_completed.previous === 0 &&
    signals.tasks_completed.current === 0 &&
    signals.tasks_completed.previous === 0 &&
    signals.inbox_recorded.current === 0 &&
    signals.inbox_recorded.previous === 0 &&
    signals.adoption_decided.current === 0 &&
    signals.adoption_decided.previous === 0;

  return (
    <section
      data-testid="period-comparison"
      className={`mb-6 w-full rounded-xl border px-4 py-3 text-left ${tone.surface}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <ArrowLeftRight size={16} className={tone.icon} />
        <h3 className={`text-sm font-semibold ${tone.title}`}>周期对比</h3>
        <span className="ml-auto text-xs text-fg-tertiary">
          近 {days} 日 vs 前 {days} 日
        </span>
      </div>
      <div className="space-y-1">
        <CountRow label="完成目标" signal={signals.goals_completed} />
        <CountRow label="完成任务" signal={signals.tasks_completed} />
        {showUntyped && (
          <CountRow label="已完成（类型未知）" signal={signals.work_completed_untyped} />
        )}
        <CountRow label="新邮件" signal={signals.inbox_recorded} />
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-fg-secondary">采纳率</span>
          <span className="text-fg-primary">
            {formatAdoptionRate(signals.adoption_rate.current)}
            <span className="ml-2 text-fg-tertiary">
              {formatRateDelta(signals.adoption_rate.delta)}
            </span>
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-fg-tertiary">
        {quiet
          ? `近 ${days} 日和前 ${days} 日都还没有完成目标、任务、新邮件或拍板记录`
          : `前 ${days} 日采纳 ${formatAdoptionRate(signals.adoption_rate.previous)} · 近 ${days} 日 ${signals.adoption_decided.current} 次拍板 / 前 ${days} 日 ${signals.adoption_decided.previous} 次`}
      </p>
      {comparison.capped && (
        <p className="mt-1 text-xs text-fg-tertiary">这段时间事件较多，数字可能不完整</p>
      )}
    </section>
  );
}

/** Today-page card. Soft-fails so a missed read does not blank the day. */
export function PeriodComparisonCard() {
  const { data } = useQuery({
    queryKey: [...queryKeys.dashboard, "periods", 7],
    queryFn: () => getPeriodComparison(7),
    staleTime: 30_000,
    retry: 1,
  });
  if (!data?.signals) return null;
  return <PeriodComparisonView comparison={data} />;
}
