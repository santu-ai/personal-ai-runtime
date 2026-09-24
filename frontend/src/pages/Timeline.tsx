import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import Button from "../components/ui/Button";
import Spinner from "../components/ui/Spinner";

/** 有原文用原文。空白或不是 Error 时用页面自己的说法，避免空白失败条。 */
function timelineErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "加载时间线失败";
}

function LoadErrorNotice({
  message,
  busy,
  onRetry,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    const button = root?.querySelector("button");
    if (!root || !button || root.contains(document.activeElement)) return;
    button.focus();
  }, [message]);

  return (
    <div
      ref={ref}
      className="space-y-2 rounded-xl border border-danger/30 p-4"
      data-testid="timeline-load-error"
      role="alert"
    >
      <p className="text-sm text-danger">{message}</p>
      <Button
        size="sm"
        variant="secondary"
        aria-busy={busy || undefined}
        onClick={() => {
          if (busy) return;
          onRetry();
        }}
      >
        {busy ? (
          <span aria-hidden="true" className="inline-flex">
            <Spinner size="sm" />
          </span>
        ) : null}
        重试
      </Button>
    </div>
  );
}

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

/** 非空 work_id 打开任务页。空白不编造链接，也不使用 correlation_id。 */
function taskPageHref(workId: string | null | undefined): string | undefined {
  if (typeof workId !== "string") return undefined;
  const id = workId.trim();
  if (!id) return undefined;
  return `/tasks/${encodeURIComponent(id)}`;
}

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
    isFetchNextPageError,
    isFetching,
    error,
    refetch,
  } = useTimelineInfiniteQuery();

  const events = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const icons = data?.pages[0]?.icons ?? {};

  const groupedEvents = groupByDay(events);
  const dayKeys = Object.keys(groupedEvents);
  const errorMessage = timelineErrorMessage(error);
  const loadedError = Boolean(error) && events.length > 0 && !loading;
  // 首次失败时还没有事件。重试一开始会把查询错误清掉，这里留住原因，按钮才不会被「加载中」换掉。
  const [heldInitialError, setHeldInitialError] = useState<string | null>(null);
  const shownInitialError =
    events.length > 0 ? null : error ? errorMessage : isFetching ? heldInitialError : null;

  useEffect(() => {
    if (events.length > 0 || (!error && !isFetching)) {
      setHeldInitialError(null);
      return;
    }
    if (error) setHeldInitialError(errorMessage);
  }, [events.length, error, errorMessage, isFetching]);

  return (
    <div className="page-shell">
      <div className="page-container-narrow">
        <div className="page-header mb-6">
          <div>
            <h2 className="page-title">人生时间线</h2>
            <p className="page-subtitle">你的 AI 记录的一切</p>
          </div>
        </div>

        {shownInitialError ? (
          <LoadErrorNotice
            message={shownInitialError}
            busy={isFetching}
            onRetry={() => void refetch()}
          />
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-fg-tertiary">
            <Loader2 size={24} className="animate-spin" />
            加载中…
          </div>
        ) : dayKeys.length === 0 ? (
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
                    const taskHref = taskPageHref(event.work_id);
                    return (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 p-3 bg-surface-raised border border-border-subtle rounded-lg hover:border-border-strong transition-colors"
                      >
                        <Icon size={16} className={`${iconInfo.color} mt-0.5 shrink-0`} />
                        <div className="flex-1 min-w-0">
                          {taskHref ? (
                            <Link
                              to={taskHref}
                              className="block text-sm text-fg-secondary hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                            >
                              {event.description}
                            </Link>
                          ) : (
                            <p className="text-sm text-fg-secondary">{event.description}</p>
                          )}
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

        {loadedError ? (
          <div className="mt-4">
            <LoadErrorNotice
              message={errorMessage}
              busy={isFetching || loadingMore}
              onRetry={() => void (isFetchNextPageError ? fetchNextPage() : refetch())}
            />
          </div>
        ) : null}

        {hasMore && !loadedError && (
          <div className="flex justify-center py-6">
            <button
              type="button"
              onClick={() => void fetchNextPage()}
              disabled={loadingMore}
              className="px-6 py-2 bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg text-sm transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {loadingMore ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
              加载更多
            </button>
          </div>
        )}

        {!hasMore && events.length > 0 && !loadedError && (
          <p className="text-center text-fg-disabled text-xs py-6">已经是最早的记录</p>
        )}
      </div>
    </div>
  );
}
