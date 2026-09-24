import { useQuery } from "@tanstack/react-query";
import { ThumbsUp } from "lucide-react";
import { getGovernanceSummary, type AdoptionSummary } from "../../api/telemetry";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";
import { STATUS_TONE } from "../ui/statusTone";

export function formatAdoptionRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function AdoptionSummaryView({
  adoption,
  onOpen,
}: {
  adoption: AdoptionSummary;
  onOpen?: () => void;
}) {
  const tone = STATUS_TONE.neutral;
  const body = (
    <>
      <div className="flex items-center gap-2 mb-1">
        <ThumbsUp size={16} className={tone.icon} />
        <h3 className={`text-sm font-semibold ${tone.title}`}>建议采纳</h3>
        <span className="ml-auto text-xs text-fg-tertiary">
          近 {adoption.days} 日 {formatAdoptionRate(adoption.adoption_rate)}
        </span>
      </div>
      {adoption.decided === 0 ? (
        <p className="text-xs text-fg-tertiary">还没有你拍板的工具建议或记忆</p>
      ) : (
        <p className={`text-xs ${tone.body}`}>
          工具建议 {adoption.suggestions.adopted} 采纳 / {adoption.suggestions.rejected} 拒绝
          {" · "}
          记忆 {adoption.memories.ratified} 确认 / {adoption.memories.rejected} 拒绝
        </p>
      )}
    </>
  );
  const className = `mb-5 w-full rounded-lg border px-4 py-3.5 text-left transition-colors ${tone.surface} ${
    onOpen
      ? "cursor-pointer hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      : ""
  }`;
  if (!onOpen) {
    return (
      <section data-testid="adoption-summary" className={className}>
        {body}
      </section>
    );
  }
  return (
    <button
      type="button"
      data-testid="adoption-summary"
      data-dashboard-opener="adoption"
      onClick={onOpen}
      className={className}
    >
      {body}
    </button>
  );
}

/** Today-page card. Soft-fails so a telemetry miss does not blank the day. */
export function AdoptionSummaryCard({ onOpen }: { onOpen?: () => void }) {
  const { data } = useQuery({
    queryKey: [...queryKeys.governance, 7],
    queryFn: () => getGovernanceSummary(7),
    staleTime: 30_000,
    // 离开今天时这张卡会卸掉。按库的默认留住数据，回来的第一帧还在，焦点才能落回这张卡。
    gcTime: 5 * 60_000,
    retry: 1,
  });
  if (!data?.adoption) return null;
  return <AdoptionSummaryView adoption={data.adoption} onOpen={onOpen} />;
}
