import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Brain,
  Check,
  CircleCheck,
  Clock,
  Lightbulb,
  Loader2,
  Mail,
  MessageSquare,
  Play,
  Shield,
  ShieldCheck,
  Target,
  Zap,
} from "lucide-react";
import { useTimelineInfiniteQuery } from "../hooks/useTimelineQuery";
import type { TimelineEvent } from "../api/timeline";

const ICON_MAP: Record<string, { Icon: LucideIcon; color: string }> = {
  target: { Icon: Target, color: "text-warning" },
  "check-circle": { Icon: CircleCheck, color: "text-success" },
  check: { Icon: Check, color: "text-success" },
  brain: { Icon: Brain, color: "text-insight" },
  lightbulb: { Icon: Lightbulb, color: "text-warning" },
  "message-square": { Icon: MessageSquare, color: "text-insight" },
  zap: { Icon: Zap, color: "text-warning" },
  shield: { Icon: Shield, color: "text-danger" },
  "shield-check": { Icon: ShieldCheck, color: "text-success" },
  mail: { Icon: Mail, color: "text-insight" },
  clock: { Icon: Clock, color: "text-fg-tertiary" },
  bell: { Icon: Bell, color: "text-warning" },
  play: { Icon: Play, color: "text-success" },
  activity: { Icon: Activity, color: "text-fg-tertiary" },
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  } else if (diffDays === 1) {
    return "昨天";
  } else if (diffDays < 7) {
    return `${diffDays} 天前`;
  } else {
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }
}

function groupByDay(events: TimelineEvent[]): Record<string, TimelineEvent[]> {
  const groups: Record<string, TimelineEvent[]> = {};
  for (const event of events) {
    const d = new Date(event.ts);
    const key = d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
  }
  return groups;
}

export default function TimelinePage() {
  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
    error,
    refetch,
  } = useTimelineInfiniteQuery();

  const events = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const icons = data?.pages[0]?.icons ?? {};

  const groupedEvents = groupByDay(events);
  const dayKeys = Object.keys(groupedEvents);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="text-fg-secondary animate-spin" />
      </div>
    );
  }

  if (error) {
    const msg = error instanceof Error ? error.message : "加载失败";
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-fg-tertiary mb-2">
            <Clock size={32} className="mx-auto mb-2" />
          </div>
          <div className="text-fg-secondary mb-4">{msg}</div>
          <button
            onClick={() => void refetch()}
            className="px-4 py-2 bg-surface-overlay hover:bg-border-strong text-white rounded-lg text-sm transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-fg-primary">人生时间线</h2>
            <p className="text-sm text-fg-tertiary mt-0.5">你的 AI 记录的一切</p>
          </div>
        </div>

        {dayKeys.length === 0 ? (
          <div className="text-center py-16">
            <Clock size={48} className="mx-auto mb-4 text-fg-disabled" />
            <p className="text-fg-tertiary">还没有任何事件</p>
            <p className="text-fg-disabled text-sm mt-1">
              开始使用 AI 对话或创建目标后，这里就会出现你的数据足迹
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {dayKeys.map((day) => (
              <div key={day}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-fg-tertiary" />
                  <h3 className="text-sm font-medium text-fg-secondary">{day}</h3>
                  <span className="text-xs text-fg-disabled">
                    {groupedEvents[day].length} 个事件
                  </span>
                </div>
                <div className="space-y-2">
                  {groupedEvents[day].map((event) => {
                    const iconKey = icons[event.type] || "activity";
                    const iconInfo = ICON_MAP[iconKey] ?? {
                      Icon: Activity,
                      color: "text-fg-tertiary",
                    };
                    const Icon = iconInfo.Icon;
                    return (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 p-3 bg-surface-raised border border-border-subtle rounded-lg hover:border-border-strong transition-colors"
                      >
                        <Icon size={16} className={`${iconInfo.color} mt-0.5 shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-fg-secondary">{event.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-fg-disabled">{formatDate(event.ts)}</span>
                            {event.actor && event.actor !== "user" && (
                              <span className="text-xs text-fg-disabled bg-surface-overlay px-1.5 py-0.5 rounded">
                                {event.actor.startsWith("agent:")
                                  ? "AI"
                                  : event.actor === "scheduler"
                                    ? "定时"
                                    : event.actor}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center py-6">
            <button
              onClick={() => void fetchNextPage()}
              disabled={loadingMore}
              className="px-6 py-2 bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loadingMore ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              加载更多
            </button>
          </div>
        )}

        {!hasMore && events.length > 0 && (
          <p className="text-center text-fg-disabled text-xs py-6">已经是最早的记录</p>
        )}
      </div>
    </div>
  );
}
