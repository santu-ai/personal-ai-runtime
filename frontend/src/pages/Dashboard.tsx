import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { markNotificationRead, type Notification } from "../api/client";
import { useDashboard } from "../hooks/useDashboard";
import { useLiveNotifications } from "../hooks/useNotifications";
import { useApprovalsQuery } from "../hooks/useApprovalsQuery";
import { useInboxQuery } from "../hooks/useInboxQuery";
import { useGoalsQuery } from "../hooks/useGoalsQuery";
import { useProposedMemoryCountQuery } from "../hooks/useMemoriesQuery";
import NotificationDetailModal from "../components/notifications/NotificationDetailModal";
import { TrustReportPanel } from "./TrustReport";
import TodayActions from "../components/dashboard/TodayActions";
import { AdoptionSummaryCard } from "../components/dashboard/AdoptionSummary";
import { PeriodComparisonCard } from "../components/dashboard/PeriodComparison";
import ExecutionTrustPanel from "../components/dashboard/ExecutionTrustPanel";
import TimerBriefPanel from "../components/dashboard/TimerBriefPanel";
import RemindersPanel from "../components/dashboard/RemindersPanel";
import HealthPanel from "../components/dashboard/HealthPanel";
import MonitorsPanel from "../components/dashboard/MonitorsPanel";
import {
  buildTodayBuckets,
  mergeLiveAndServerNotifications,
} from "../components/dashboard/todayBuckets";
import { Shield, Radar } from "lucide-react";
import Button from "../components/ui/Button";
import PageHeader from "../components/ui/PageHeader";
import LoadErrorNotice, {
  queryErrorMessage,
  useHeldQueryError,
} from "../components/ui/LoadErrorNotice";
import { useInvalidateNotifications } from "../hooks/useNotificationsQuery";
import { useErrorStore } from "../stores/errorStore";
import type { TodayColumnState } from "../components/dashboard/TodayActions";

interface BucketSource {
  hasData: boolean;
  error: unknown;
  isFetching: boolean;
  isPending: boolean;
  refetch: () => void;
}

function bucketSource(query: {
  data?: unknown;
  error?: unknown;
  isFetching?: boolean;
  isPending?: boolean;
  refetch?: () => unknown;
}): BucketSource {
  const hasData = query.data !== undefined;
  const error = query.error ?? null;
  return {
    hasData,
    error,
    isFetching: query.isFetching ?? false,
    isPending: !hasData && !error && Boolean(query.isPending),
    refetch: () => {
      void query.refetch?.();
    },
  };
}

function joinMessages(parts: Array<string | null>): string | null {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    lines.push(part);
  }
  return lines.length > 0 ? lines.join("；") : null;
}

function columnState(message: string | null, sources: BucketSource[]): TodayColumnState {
  return {
    error: message,
    busy: sources.some((source) => !source.hasData && source.isFetching),
    pending: !message && sources.some((source) => source.isPending),
    onRetry: () => {
      for (const source of sources) {
        if (!source.hasData) source.refetch();
      }
    },
  };
}

function getDateString(): string {
  const d = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

type DashboardTab = "today" | "trust" | "monitors";
type DashboardOpener = "trust" | "monitors" | "adoption";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export default function DashboardPage() {
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: DashboardTab =
    tabParam === "trust" ? "trust" : tabParam === "monitors" ? "monitors" : "today";
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const openerRef = useRef<DashboardOpener | null>(null);
  const shouldFocusBack = useRef(false);
  const pendingRestore = useRef<DashboardOpener | null>(null);
  const setTab = useCallback(
    (next: DashboardTab) => {
      if (next === "today") {
        setSearchParams({}, { replace: true });
      } else {
        setSearchParams({ tab: next }, { replace: true });
      }
    },
    [setSearchParams],
  );
  const openTab = useCallback(
    (next: "trust" | "monitors", opener: DashboardOpener) => {
      openerRef.current = opener;
      shouldFocusBack.current = true;
      setTab(next);
    },
    [setTab],
  );
  const leaveSubView = useCallback(() => {
    const current = tabRef.current;
    if (current === "today") return;
    pendingRestore.current = openerRef.current ?? (current === "monitors" ? "monitors" : "trust");
    setTab("today");
  }, [setTab]);

  const {
    cost,
    tools,
    memory,
    health,
    notifications,
    notificationsLoaded,
    notificationsError,
    notificationsFetching,
    notificationsPending,
    dashboard,
    loading,
    error,
    errorBusy,
    refresh,
    retryNotifications,
  } = useDashboard();
  const liveNotifications = useLiveNotifications();
  const approvalsQuery = useApprovalsQuery();
  const inboxQuery = useInboxQuery();
  const goalsQuery = useGoalsQuery();
  const proposedQuery = useProposedMemoryCountQuery();
  const addError = useErrorStore((s) => s.addError);
  const invalidateNotifications = useInvalidateNotifications();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const pendingApprovals = approvalsQuery.data ?? [];
  const inboxData = inboxQuery.data;
  const goals = goalsQuery.data ?? [];
  const proposedMemoryCount = proposedQuery.data ?? 0;
  const approvalsSource = bucketSource(approvalsQuery);
  const inboxSource = bucketSource(inboxQuery);
  const goalsSource = bucketSource(goalsQuery);
  const memorySource = bucketSource(proposedQuery);
  const notificationsKnown = notificationsLoaded || liveNotifications.length > 0;
  const notificationsSource: BucketSource = {
    hasData: notificationsKnown,
    error: notificationsKnown ? null : notificationsError,
    isFetching: notificationsFetching,
    isPending: !notificationsKnown && !notificationsError && notificationsPending,
    refetch: retryNotifications,
  };
  const approvalsHeld = useHeldQueryError(
    approvalsSource.hasData,
    approvalsSource.error,
    approvalsSource.isFetching,
    "加载待审批失败",
    "today-approvals",
  );
  const inboxHeld = useHeldQueryError(
    inboxSource.hasData,
    inboxSource.error,
    inboxSource.isFetching,
    "加载收件箱失败",
    "today-inbox",
  );
  const goalsHeld = useHeldQueryError(
    goalsSource.hasData,
    goalsSource.error,
    goalsSource.isFetching,
    "加载目标失败",
    "today-goals",
  );
  const memoryHeld = useHeldQueryError(
    memorySource.hasData,
    memorySource.error,
    memorySource.isFetching,
    "加载待确认记忆失败",
    "today-memories",
  );
  const notificationsHeld = useHeldQueryError(
    notificationsSource.hasData,
    notificationsSource.error,
    notificationsSource.isFetching,
    "加载提醒失败",
    "today-notifications",
  );
  const decideStatus = columnState(joinMessages([approvalsHeld, memoryHeld, inboxHeld]), [
    approvalsSource,
    memorySource,
    inboxSource,
  ]);
  const doStatus = columnState(goalsHeld, [goalsSource]);
  const handledStatus = columnState(joinMessages([notificationsHeld, inboxHeld]), [
    notificationsSource,
    inboxSource,
  ]);

  useEffect(() => {
    if (tab !== "today" || !approvalsQuery.error) return;
    addError(queryErrorMessage(approvalsQuery.error, "加载待审批失败"), "今天");
  }, [tab, approvalsQuery.error, addError]);
  useEffect(() => {
    if (tab !== "today" || !inboxQuery.error) return;
    addError(queryErrorMessage(inboxQuery.error, "加载收件箱失败"), "今天");
  }, [tab, inboxQuery.error, addError]);
  useEffect(() => {
    if (tab !== "today" || !goalsQuery.error) return;
    addError(queryErrorMessage(goalsQuery.error, "加载目标失败"), "今天");
  }, [tab, goalsQuery.error, addError]);
  useEffect(() => {
    if (tab !== "today" || !proposedQuery.error) return;
    addError(queryErrorMessage(proposedQuery.error, "加载待确认记忆失败"), "今天");
  }, [tab, proposedQuery.error, addError]);

  // 从今天打开信任或监控时，原来的按钮会卸掉，浏览器会把焦点丢到别的按钮上。
  // 绘制前把焦点放到「返回今日」，离开时放回刚才那个控件。
  // 建议采纳这张卡还不在时，先回到「信任」。随后若「重试」自己拿焦点，就留在那里。
  useLayoutEffect(() => {
    if (tab !== "today") {
      if (!shouldFocusBack.current) return;
      shouldFocusBack.current = false;
      document.querySelector<HTMLButtonElement>("[data-dashboard-back]")?.focus();
      return;
    }
    const which = pendingRestore.current;
    if (!which) return;
    pendingRestore.current = null;
    const target = document.querySelector<HTMLElement>(`[data-dashboard-opener="${which}"]`);
    const fallback =
      which === "adoption"
        ? document.querySelector<HTMLElement>('[data-dashboard-opener="trust"]')
        : null;
    (target ?? fallback)?.focus();
  }, [tab]);

  useEffect(() => {
    if (tab === "today") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[role='dialog']")) return;
      event.preventDefault();
      leaveSubView();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, leaveSubView]);

  const activeGoals = useMemo(() => goals.filter((g) => g.status === "active"), [goals]);

  const mergedNotifications = useMemo(
    () => mergeLiveAndServerNotifications(notifications, liveNotifications),
    [liveNotifications, notifications],
  );

  const todayBuckets = useMemo(
    () =>
      buildTodayBuckets({
        approvals: pendingApprovals,
        proposedMemoryCount,
        inboxEmails: inboxData?.emails ?? [],
        activeGoals,
        notifications: mergedNotifications,
      }),
    [pendingApprovals, proposedMemoryCount, inboxData?.emails, activeGoals, mergedNotifications],
  );
  const columnOwnsRetryFocus =
    (todayBuckets.decide.length === 0 && Boolean(decideStatus.error)) ||
    (todayBuckets.do.length === 0 && Boolean(doStatus.error)) ||
    (todayBuckets.handled.length === 0 && Boolean(handledStatus.error));

  const handleNotificationClick = async (n: Notification) => {
    const alreadyRead = Boolean(n.read) || readIds.has(n.id);
    setSelectedNotification(alreadyRead ? { ...n, read: 1 } : n);
    // Live optimistic ids are not persisted — skip mark-read to avoid 404.
    if (alreadyRead || n.source === "live" || n.id.startsWith("live-")) return;
    setReadIds((prev) => new Set(prev).add(n.id));
    try {
      await markNotificationRead(n.id);
      invalidateNotifications();
    } catch {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.delete(n.id);
        return next;
      });
    }
  };

  // ── Trust tab ──
  if (tab === "trust") {
    return (
      <div className="page-shell">
        <div className="page-container">
          <PageHeader
            title="信任"
            actions={
              <Button variant="secondary" size="sm" data-dashboard-back="" onClick={leaveSubView}>
                ← 返回今日
              </Button>
            }
          />
          <TrustReportPanel compact />
        </div>
      </div>
    );
  }

  // ── Monitors tab ──
  if (tab === "monitors") {
    return (
      <div className="page-shell">
        <div className="page-container-narrow">
          <PageHeader
            title="监控"
            actions={
              <Button variant="secondary" size="sm" data-dashboard-back="" onClick={leaveSubView}>
                ← 返回今日
              </Button>
            }
          />
          <MonitorsPanel />
        </div>
      </div>
    );
  }

  // 整页还没有数据时，重试会把查询错误清掉并把加载态再置上。原因留在钩子里，先画失败。
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <LoadErrorNotice
            message={error}
            busy={errorBusy}
            onRetry={refresh}
            testId="dashboard-load-error"
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-pulse text-fg-secondary">加载中...</div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-container">
        <PageHeader
          title="今天"
          description={getDateString()}
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={refresh}>
                刷新
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-dashboard-opener="monitors"
                onClick={() => openTab("monitors", "monitors")}
              >
                <Radar size={13} />
                监控
              </Button>
              <Button
                variant="secondary"
                size="sm"
                data-dashboard-opener="trust"
                onClick={() => openTab("trust", "trust")}
              >
                <Shield size={13} />
                信任
              </Button>
            </>
          }
        />

        <AdoptionSummaryCard onOpen={() => openTab("trust", "adoption")} />

        <PeriodComparisonCard />

        <TodayActions
          buckets={todayBuckets}
          decideStatus={decideStatus}
          doStatus={doStatus}
          handledStatus={handledStatus}
        />

        {dashboard?.execution_trust && <ExecutionTrustPanel trust={dashboard.execution_trust} />}

        <TimerBriefPanel
          timers={dashboard?.timer_status?.items ?? []}
          activeTimers={dashboard?.timer_status?.active_timers ?? 0}
          briefs={dashboard?.rerunnable_briefs ?? []}
        />

        <RemindersPanel
          notifications={todayBuckets.reminders.map((n) =>
            readIds.has(n.id) ? { ...n, read: 1 } : n,
          )}
          onNotificationClick={handleNotificationClick}
          loadError={notificationsHeld}
          loadBusy={notificationsSource.isFetching && !notificationsSource.hasData}
          loadPending={notificationsSource.isPending}
          onRetry={notificationsSource.refetch}
          autoFocusRetry={Boolean(notificationsHeld) && !columnOwnsRetryFocus}
        />

        <HealthPanel
          cost={cost}
          tools={tools}
          memory={memory}
          health={health}
          dashboard={dashboard}
        />
      </div>

      <NotificationDetailModal
        notification={selectedNotification}
        onClose={() => setSelectedNotification(null)}
      />
    </div>
  );
}
