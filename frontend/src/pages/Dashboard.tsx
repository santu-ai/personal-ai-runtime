import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type ToolSummaryItem, markNotificationRead, type Notification } from "../api/client";
import { useDashboard } from "../hooks/useDashboard";
import { useNotifications } from "../hooks/useNotifications";
import { useApprovalsQuery } from "../hooks/useApprovalsQuery";
import { useInboxQuery } from "../hooks/useInboxQuery";
import { toolLabel } from "../utils/toolLabels";
import NotificationDetailModal from "../components/notifications/NotificationDetailModal";
import { notificationPreview } from "../utils/notificationUtils";
import { TrustReportPanel } from "./TrustReport";
import {
  MessageSquare,
  Mail,
  Target,
  Zap,
  AlertCircle,
  Brain,
  Database,
  Shield,
  Download,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";

function getDateString(): string {
  const d = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

function TabBar({
  tab,
  setTab,
}: {
  tab: "overview" | "trust";
  setTab: (next: "overview" | "trust") => void;
}) {
  return (
    <div className="flex gap-1 bg-surface-overlay rounded-lg p-1 mb-6 w-fit">
      <button
        type="button"
        onClick={() => setTab("overview")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
          tab === "overview" ? "bg-border-strong text-white" : "text-fg-secondary hover:text-fg-primary"
        }`}
      >
        <LayoutDashboard size={14} />
        概览
      </button>
      <button
        type="button"
        onClick={() => setTab("trust")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
          tab === "trust" ? "bg-border-strong text-white" : "text-fg-secondary hover:text-fg-primary"
        }`}
      >
        <Shield size={14} />
        信任
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "trust" ? "trust" : "overview";
  const setTab = (next: "overview" | "trust") => {
    if (next === "overview") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: "trust" }, { replace: true });
    }
  };
  const navigate = useNavigate();

  const { cost, tools, memory, health, notifications, dashboard, loading, error, refresh } =
    useDashboard();
  const { liveNotifications } = useNotifications();
  const { data: pendingApprovals = [] } = useApprovalsQuery();
  const { data: inboxData } = useInboxQuery();
  const pendingApprovalCount = pendingApprovals.length;
  const pendingInboxCount = inboxData?.emails?.length ?? 0;

  if (tab === "trust") {
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          <TabBar tab={tab} setTab={setTab} />
          <TrustReportPanel compact />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-fg-secondary animate-pulse">加载中...</div>
      </div>
    );
  }

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

  const totalTokens = (cost?.total_prompt_tokens || 0) + (cost?.total_completion_tokens || 0);
  const successRate =
    cost && cost.total_calls > 0
      ? (((cost.total_calls - cost.failed_calls) / cost.total_calls) * 100).toFixed(1)
      : "100";

  const mergedNotifications = [...liveNotifications, ...notifications]
    .reduce<typeof notifications>((acc, item) => {
      const key = `${item.type}:${item.title}`;
      if (!acc.some((n) => n.id === item.id || `${n.type}:${n.title}` === key)) {
        acc.push(item);
      }
      return acc;
    }, [])
    .slice(0, 6);

  const handleNotificationClick = async (n: Notification) => {
    setSelectedNotification(n);
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
      } catch {
        // still show detail
      }
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-fg-primary">AI 概览</h2>
            <p className="text-sm text-fg-tertiary mt-0.5">{getDateString()}</p>
          </div>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg transition-colors"
          >
            刷新
          </button>
        </div>

        <TabBar tab={tab} setTab={setTab} />

        {(pendingApprovalCount > 0 || pendingInboxCount > 0) && (
          <div className="bg-surface-raised border border-warning/30 rounded-xl p-4 mb-6">
            <h3 className="text-sm font-medium text-warning mb-3">待你决断</h3>
            <div className="flex flex-wrap gap-2">
              {pendingApprovalCount > 0 && (
                <button
                  type="button"
                  onClick={() => navigate("/approvals")}
                  className="flex items-center gap-2 px-3 py-2 bg-warning/10 hover:bg-warning/20 text-warning rounded-lg border border-warning/30 text-sm transition-colors"
                >
                  <ShieldCheck size={14} />
                  <span>{pendingApprovalCount} 项待审批</span>
                </button>
              )}
              {pendingInboxCount > 0 && (
                <button
                  type="button"
                  onClick={() => navigate("/inbox")}
                  className="flex items-center gap-2 px-3 py-2 bg-insight/10 hover:bg-insight/20 text-insight rounded-lg border border-insight/30 text-sm transition-colors"
                >
                  <Mail size={14} />
                  <span>{pendingInboxCount} 封待处理邮件</span>
                </button>
              )}
            </div>
          </div>
        )}

        {dashboard?.data_sovereignty && (
          <div className="bg-surface-raised border border-border-subtle rounded-xl p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Database size={16} className="text-success" />
              <h3 className="text-sm font-medium text-fg-secondary">我的数据</h3>
              <span className="ml-auto flex items-center gap-1 text-xs text-success">
                <Shield size={12} />
                全部本地存储
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center py-2">
                <div className="text-2xl font-bold text-insight">
                  {(dashboard.data_sovereignty.total_events || 0).toLocaleString()}
                </div>
                <div className="text-xs text-fg-tertiary mt-1">个事件</div>
              </div>
              <div className="text-center py-2">
                <div className="text-2xl font-bold text-insight">
                  {(dashboard.data_sovereignty.total_memories || 0).toLocaleString()}
                </div>
                <div className="text-xs text-fg-tertiary mt-1">条记忆</div>
              </div>
              <div className="text-center py-2">
                <div className="text-2xl font-bold text-warning">
                  {(dashboard.data_sovereignty.total_goals || 0).toLocaleString()}
                </div>
                <div className="text-xs text-fg-tertiary mt-1">个目标</div>
              </div>
              <div className="text-center py-2">
                <div className="text-2xl font-bold text-insight">
                  {(dashboard.data_sovereignty.total_conversations || 0).toLocaleString()}
                </div>
                <div className="text-xs text-fg-tertiary mt-1">个对话</div>
              </div>
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs text-fg-tertiary">
              <span>
                自我陈述:
                <span className="text-insight ml-1 font-medium">
                  {dashboard.data_sovereignty.memories_self_report || 0}
                </span>
              </span>
              <span>
                AI 提炼:
                <span className="text-warning ml-1 font-medium">
                  {dashboard.data_sovereignty.memories_claim || 0}
                </span>
              </span>
              <span>
                目标进度:
                <span className="text-success ml-1 font-medium">
                  {dashboard.data_sovereignty.goals_active || 0} 进行中
                </span>
                <span className="text-fg-disabled mx-1">/</span>
                <span className="text-fg-secondary font-medium">
                  {dashboard.data_sovereignty.goals_completed || 0} 已完成
                </span>
              </span>
            </div>
            {dashboard.data_sovereignty.last_belief_reflection && (
              <div className="text-xs text-fg-disabled mb-3">
                最近一次 AI 反思：
                {new Date(dashboard.data_sovereignty.last_belief_reflection).toLocaleString(
                  "zh-CN",
                )}
              </div>
            )}
            {dashboard.data_sovereignty.export_supported && (
              <button
                onClick={async () => {
                  try {
                    const { downloadExport } = await import("../api/client");
                    await downloadExport();
                    alert("数据导出成功");
                  } catch {
                    alert("导出失败，请在设置页面操作");
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-overlay hover:bg-border-strong text-fg-secondary rounded-lg text-xs transition-colors"
              >
                <Download size={12} />
                导出我的数据
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 px-4 py-2.5 bg-surface-overlay hover:bg-border-strong text-white rounded-xl border border-border-subtle transition-all text-sm font-medium"
          >
            <MessageSquare size={16} />
            <span>和 AI 对话</span>
          </button>
          <button
            onClick={() => navigate("/inbox")}
            className="flex items-center gap-2 px-4 py-2.5 bg-surface-raised hover:bg-surface-overlay text-fg-secondary rounded-xl border border-border-subtle transition-all text-sm"
          >
            <Mail size={16} className="text-insight" />
            <span>查看邮件</span>
          </button>
          <button
            onClick={() => navigate("/goals")}
            className="flex items-center gap-2 px-4 py-2.5 bg-surface-raised hover:bg-surface-overlay text-fg-secondary rounded-xl border border-border-subtle transition-all text-sm"
          >
            <Target size={16} className="text-warning" />
            <span>我的目标</span>
          </button>
        </div>

        <div className="bg-surface-raised border border-border-subtle rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Brain size={16} className="text-insight" />
            <h3 className="text-sm font-medium text-fg-secondary">AI 记住了</h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center py-2">
              <div className="text-2xl font-bold text-insight">
                {memory?.total_memories || 0}
              </div>
              <div className="text-xs text-fg-tertiary mt-1">条记忆</div>
            </div>
            <div className="text-center py-2">
              <div className="text-2xl font-bold text-success">{memory?.recent_7d || 0}</div>
              <div className="text-xs text-fg-tertiary mt-1">近 7 天新增</div>
            </div>
            <div className="text-center py-2">
              <div className="text-2xl font-bold text-warning">
                {memory ? Object.keys(memory.categories).length : 0}
              </div>
              <div className="text-xs text-fg-tertiary mt-1">个分类</div>
            </div>
          </div>
          {memory && Object.keys(memory.categories).length > 0 && (
            <div className="mt-4 pt-3 border-t border-border-subtle">
              <div className="flex flex-wrap gap-2">
                {Object.entries(memory.categories).map(([cat, count]) => (
                  <button
                    key={cat}
                    onClick={() => navigate("/memories")}
                    className="px-2 py-1 bg-surface-overlay hover:bg-border-strong rounded text-xs text-fg-secondary transition-colors"
                  >
                    {cat}: {count}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-surface-raised border border-border-subtle rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-warning" />
            <h3 className="text-sm font-medium text-fg-secondary">AI 给你的提醒</h3>
          </div>
          {mergedNotifications.length > 0 ? (
            <div className="space-y-2">
              {mergedNotifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void handleNotificationClick(n)}
                  className={`w-full text-left p-3 bg-surface-overlay/50 rounded-lg hover:bg-surface-overlay transition-colors ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  <div className={`text-sm ${n.read ? "text-fg-secondary" : "text-fg-primary"}`}>
                    {n.title}
                  </div>
                  <div className="text-xs text-fg-tertiary mt-1 line-clamp-2">
                    {notificationPreview(n.content)}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-fg-disabled text-sm text-center py-4">暂无提醒</p>
          )}
        </div>

        <div className="border-t border-border-subtle pt-4">
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-fg-tertiary hover:text-fg-secondary transition-colors"
          >
            {showDiagnostics ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>系统诊断（开发者用）</span>
          </button>

          {showDiagnostics && (
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-surface-raised border border-border-subtle rounded-lg p-3">
                  <div className="text-xs text-fg-tertiary mb-1">LLM 成功率</div>
                  <div
                    className="text-lg font-bold"
                    style={{ color: Number(successRate) >= 95 ? "#10b981" : "#f59e0b" }}
                  >
                    {successRate}%
                  </div>
                </div>
                <div className="bg-surface-raised border border-border-subtle rounded-lg p-3">
                  <div className="text-xs text-fg-tertiary mb-1">任务队列</div>
                  <div className="text-lg font-bold text-fg-secondary">
                    {health?.task_queue_length ?? 0}
                  </div>
                </div>
                <div className="bg-surface-raised border border-border-subtle rounded-lg p-3">
                  <div className="text-xs text-fg-tertiary mb-1">工具失败率</div>
                  <div
                    className="text-lg font-bold"
                    style={{
                      color: (health?.tool_failure_rate_24h || 0) < 0.05 ? "#10b981" : "#ef4444",
                    }}
                  >
                    {((health?.tool_failure_rate_24h || 0) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
                <div className="text-xs text-fg-tertiary mb-3">Token 与成本 (7天)</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-tertiary">总 Token</span>
                    <span className="text-fg-secondary font-mono">{totalTokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-tertiary">预估费用</span>
                    <span className="text-fg-secondary font-mono">
                      ${(cost?.total_cost || 0).toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-tertiary">调用次数</span>
                    <span className="text-fg-secondary font-mono">{cost?.total_calls || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-tertiary">平均延迟</span>
                    <span className="text-fg-secondary font-mono">
                      {(cost?.avg_latency_ms || 0).toFixed(0)}ms
                    </span>
                  </div>
                </div>
              </div>

              {tools.length > 0 && (
                <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
                  <div className="text-xs text-fg-tertiary mb-2">工具调用 (7天)</div>
                  <div className="space-y-1">
                    {tools.map((t: ToolSummaryItem) => {
                      const rate =
                        t.total_calls > 0
                          ? (((t.total_calls - t.failed_calls) / t.total_calls) * 100).toFixed(0)
                          : "0";
                      const color =
                        Number(rate) >= 95 ? "#10b981" : Number(rate) >= 80 ? "#f59e0b" : "#ef4444";
                      return (
                        <div
                          key={t.tool_name}
                          className="flex items-center justify-between py-1.5 text-xs"
                        >
                          <span className="text-fg-secondary">{toolLabel(t.tool_name)}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-fg-disabled">{t.total_calls} 次</span>
                            <span style={{ color }}>{rate}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <NotificationDetailModal
        notification={selectedNotification}
        onClose={() => setSelectedNotification(null)}
      />
    </div>
  );
}
