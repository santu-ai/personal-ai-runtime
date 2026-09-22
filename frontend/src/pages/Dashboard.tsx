import { useState, useMemo } from "react";
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
import RemindersPanel from "../components/dashboard/RemindersPanel";
import HealthPanel from "../components/dashboard/HealthPanel";
import MonitorsPanel from "../components/dashboard/MonitorsPanel";
import {
  buildTodayBuckets,
  mergeLiveAndServerNotifications,
} from "../components/dashboard/todayBuckets";
import { Shield, AlertCircle, Radar } from "lucide-react";
import Button from "../components/ui/Button";
import PageHeader from "../components/ui/PageHeader";

function getDateString(): string {
  const d = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

type DashboardTab = "today" | "trust" | "monitors";

export default function DashboardPage() {
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: DashboardTab =
    tabParam === "trust" ? "trust" : tabParam === "monitors" ? "monitors" : "today";
  const setTab = (next: DashboardTab) => {
    if (next === "today") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  const { cost, tools, memory, health, notifications, dashboard, loading, error, refresh } =
    useDashboard();
  const liveNotifications = useLiveNotifications();
  const { data: pendingApprovals = [] } = useApprovalsQuery();
  const { data: inboxData } = useInboxQuery();
  const { data: goals = [] } = useGoalsQuery();
  const { data: proposedMemoryCount = 0 } = useProposedMemoryCountQuery();

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

  const handleNotificationClick = async (n: Notification) => {
    setSelectedNotification(n);
    // Live optimistic ids are not persisted — skip mark-read to avoid 404.
    if (!n.read && n.source !== "live" && !n.id.startsWith("live-")) {
      try {
        await markNotificationRead(n.id);
      } catch {
        // still show detail
      }
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
              <Button variant="secondary" size="sm" onClick={() => setTab("today")}>
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
              <Button variant="secondary" size="sm" onClick={() => setTab("today")}>
                ← 返回今日
              </Button>
            }
          />
          <MonitorsPanel />
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-pulse text-fg-secondary">加载中...</div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-2 text-fg-tertiary">
            <AlertCircle size={32} className="mx-auto mb-2" />
          </div>
          <div className="mb-4 text-fg-secondary">{error}</div>
          <Button onClick={refresh}>重试</Button>
        </div>
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
              <Button variant="secondary" size="sm" onClick={() => setTab("monitors")}>
                <Radar size={13} />
                监控
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setTab("trust")}>
                <Shield size={13} />
                信任
              </Button>
            </>
          }
        />

        <AdoptionSummaryCard onOpen={() => setTab("trust")} />

        <PeriodComparisonCard />

        <TodayActions buckets={todayBuckets} />

        {dashboard?.execution_trust && <ExecutionTrustPanel trust={dashboard.execution_trust} />}

        <RemindersPanel
          notifications={todayBuckets.reminders}
          onNotificationClick={handleNotificationClick}
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
