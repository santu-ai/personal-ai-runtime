import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { markNotificationRead, type Notification } from "../api/client";
import { useDashboard } from "../hooks/useDashboard";
import { useNotifications } from "../hooks/useNotifications";
import { useApprovalsQuery } from "../hooks/useApprovalsQuery";
import { useInboxQuery } from "../hooks/useInboxQuery";
import { useGoalsQuery } from "../hooks/useGoalsQuery";
import NotificationDetailModal from "../components/notifications/NotificationDetailModal";
import { TrustReportPanel } from "./TrustReport";
import TodayActions from "../components/dashboard/TodayActions";
import RemindersPanel from "../components/dashboard/RemindersPanel";
import HealthPanel from "../components/dashboard/HealthPanel";
import { Shield, AlertCircle } from "lucide-react";

function getDateString(): string {
  const d = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

export default function DashboardPage() {
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "trust" ? "trust" : "today";
  const setTab = (next: "today" | "trust") => {
    if (next === "today") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: "trust" }, { replace: true });
    }
  };

  const { cost, tools, memory, health, notifications, dashboard, loading, error, refresh } =
    useDashboard();
  const { liveNotifications } = useNotifications();
  const { data: pendingApprovals = [] } = useApprovalsQuery();
  const { data: inboxData } = useInboxQuery();
  const { data: goals = [] } = useGoalsQuery();

  const pendingInboxCount = inboxData?.emails?.length ?? 0;

  // 活跃目标：status 为 active 或 in_progress 的目标
  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === "active" || g.status === "in_progress"),
    [goals],
  );

  // Prefer HTTP-pulled notifications; keep live WS items only when no server
  // item shares the same type:title key (optimistic until refetch arrives).
  const mergedNotifications = useMemo(() => {
    const serverItems: Notification[] = notifications.map((n) => ({
      ...n,
      source: "server" as const,
    }));
    const serverKeys = new Set(serverItems.map((n) => `${n.type}:${n.title}`));
    const liveOnly = liveNotifications
      .filter((n) => n.source !== "server" && !serverKeys.has(`${n.type}:${n.title}`))
      .map((n) => ({ ...n, source: "live" as const }));
    return [...liveOnly, ...serverItems].slice(0, 6);
  }, [liveNotifications, notifications]);

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
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-fg-primary">信任</h2>
            <button
              onClick={() => setTab("today")}
              className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg transition-colors"
            >
              ← 返回 Today
            </button>
          </div>
          <TrustReportPanel compact />
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-fg-secondary animate-pulse">加载中...</div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-fg-tertiary mb-2">
            <AlertCircle size={32} className="mx-auto mb-2" />
          </div>
          <div className="text-fg-secondary mb-4">{error}</div>
          <button
            onClick={refresh}
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
      <div className="max-w-3xl mx-auto">
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold text-fg-primary">Today</h2>
            <p className="text-sm text-fg-tertiary mt-0.5">{getDateString()}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg transition-colors"
            >
              刷新
            </button>
            <button
              onClick={() => setTab("trust")}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg transition-colors"
            >
              <Shield size={13} />
              信任
            </button>
          </div>
        </div>

        {/* ── 今天最值得处理的（动态主卡区）── */}
        <TodayActions
          pendingApprovals={pendingApprovals}
          activeGoals={activeGoals}
          pendingInboxCount={pendingInboxCount}
          inboxEmails={inboxData?.emails ?? []}
        />

        {/* ── AI 给你的提醒 ── */}
        <RemindersPanel
          notifications={mergedNotifications}
          onNotificationClick={handleNotificationClick}
        />

        {/* ── 运行状况（高级视图，默认折叠）── */}
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
