import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type ToolSummaryItem, markNotificationRead, type Notification } from "../api/client";
import { useDashboard } from "../hooks/useDashboard";
import { useNotifications } from "../hooks/useNotifications";
import { useApprovalsQuery } from "../hooks/useApprovalsQuery";
import { useInboxQuery } from "../hooks/useInboxQuery";
import { useGoalsQuery } from "../hooks/useGoalsQuery";
import { toolLabel } from "../utils/toolLabels";
import NotificationDetailModal from "../components/notifications/NotificationDetailModal";
import { notificationPreview } from "../utils/notificationUtils";
import { TrustReportPanel } from "./TrustReport";
import {
  ShieldCheck,
  Target,
  Mail,
  Zap,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Shield,
  Activity,
} from "lucide-react";

function getDateString(): string {
  const d = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

export default function DashboardPage() {
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "trust" ? "trust" : "today";
  const setTab = (next: "today" | "trust") => {
    if (next === "today") {
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
  const { data: goals = [] } = useGoalsQuery();

  const pendingApprovalCount = pendingApprovals.length;
  const pendingInboxCount = inboxData?.emails?.length ?? 0;

  // 活跃目标：status 为 active 或 in_progress 的目标
  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === "active" || g.status === "in_progress"),
    [goals],
  );

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

  // ── Auxiliaries ──
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

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
      return iso;
    }
  };

  const hasActions = pendingApprovalCount > 0 || activeGoals.length > 0 || pendingInboxCount > 0;

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
        {hasActions ? (
          <>
            {pendingApprovalCount > 0 ? (
              /* 有审批：审批 2/3 + 目标 1/3 */
              <div className="flex gap-3 mb-6">
                <div className="w-2/3">
                  <div className="bg-surface-raised border border-warning/40 rounded-xl p-5 h-full">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck size={18} className="text-warning" />
                      <h3 className="text-sm font-semibold text-fg-primary">待你决断</h3>
                      <span className="ml-auto text-xs text-warning font-medium">
                        {pendingApprovalCount} 项
                      </span>
                    </div>
                    <div className="space-y-2">
                      {pendingApprovals.slice(0, 3).map((item) => {
                        const isExpiring = item.expires_at
                          ? new Date(item.expires_at).getTime() - Date.now() < 3600000
                          : false;
                        return (
                          <div
                            key={item.id}
                            className="flex items-center gap-2 text-xs p-2 bg-warning/5 rounded-lg border border-warning/20"
                          >
                            <span className="text-warning shrink-0">{isExpiring ? "⏱" : "⚠"}</span>
                            <span className="text-fg-primary truncate flex-1">
                              {item.action || "—"}
                            </span>
                            {item.expires_at && (
                              <span
                                className={`shrink-0 ${isExpiring ? "text-danger" : "text-fg-tertiary"}`}
                              >
                                {formatTime(item.expires_at)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {pendingApprovals.length > 3 && (
                        <div className="text-xs text-fg-tertiary text-center">
                          ...还有 {pendingApprovals.length - 3} 项
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => navigate("/approvals")}
                      className="mt-3 flex items-center gap-1.5 px-4 py-2 bg-warning/10 hover:bg-warning/20 text-warning rounded-lg text-sm font-medium transition-colors w-full justify-center"
                    >
                      <ShieldCheck size={14} />
                      去处理
                    </button>
                  </div>
                </div>

                <div className="w-1/3 space-y-3">
                  {/* 进行中目标 */}
                  {activeGoals.length > 0 && (
                    <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Target size={14} className="text-warning" />
                        <span className="text-xs font-medium text-fg-secondary">进行中</span>
                        <span className="text-xs text-fg-tertiary ml-auto">
                          {activeGoals.length}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {activeGoals.slice(0, 3).map((g) => (
                          <div key={g.id} className="flex items-center gap-2 text-xs">
                            <span className="truncate flex-1 text-fg-primary">{g.title}</span>
                            <span className="text-fg-tertiary shrink-0">
                              {Math.round(g.progress * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => navigate("/goals")}
                        className="mt-2 text-xs text-insight hover:text-insight/80 transition-colors"
                      >
                        查看全部 →
                      </button>
                    </div>
                  )}

                  {/* 待处理邮件 */}
                  {pendingInboxCount > 0 && (
                    <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Mail size={14} className="text-insight" />
                        <span className="text-xs font-medium text-fg-secondary">待处理邮件</span>
                        <span className="text-xs text-fg-tertiary ml-auto">
                          {pendingInboxCount} 封
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {inboxData!.emails.slice(0, 2).map((e) => (
                          <div key={e.id} className="text-xs text-fg-secondary truncate">
                            {e.subject}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => navigate("/inbox")}
                        className="mt-2 text-xs text-insight hover:text-insight/80 transition-colors"
                      >
                        查看全部 →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* 无审批：目标 + 邮件各半 */
              <div className="flex gap-3 mb-6">
                {activeGoals.length > 0 && (
                  <div className="flex-1 bg-surface-raised border border-border-subtle rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Target size={18} className="text-warning" />
                      <h3 className="text-sm font-semibold text-fg-primary">进行中目标</h3>
                      <span className="ml-auto text-xs text-fg-tertiary">
                        {activeGoals.length} 项
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {activeGoals.slice(0, 5).map((g) => (
                        <div key={g.id} className="flex items-center gap-3">
                          <span className="text-sm text-fg-primary truncate flex-1">{g.title}</span>
                          <span className="text-xs text-fg-tertiary shrink-0">
                            {Math.round(g.progress * 100)}%
                          </span>
                          <div className="w-16 h-1 bg-surface-overlay rounded-full overflow-hidden shrink-0">
                            <div
                              className="h-full bg-insight rounded-full"
                              style={{ width: `${Math.round(g.progress * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => navigate("/goals")}
                      className="mt-3 text-xs text-insight hover:text-insight/80 transition-colors"
                    >
                      查看全部 →
                    </button>
                  </div>
                )}
                {pendingInboxCount > 0 && (
                  <div className="flex-1 bg-surface-raised border border-border-subtle rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Mail size={18} className="text-insight" />
                      <h3 className="text-sm font-semibold text-fg-primary">待处理邮件</h3>
                      <span className="ml-auto text-xs text-fg-tertiary">
                        {pendingInboxCount} 封
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {inboxData!.emails.slice(0, 5).map((e) => (
                        <div key={e.id} className="text-sm text-fg-secondary truncate">
                          {e.subject}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => navigate("/inbox")}
                      className="mt-3 text-xs text-insight hover:text-insight/80 transition-colors"
                    >
                      查看全部 →
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* 空态 */
          <div className="bg-surface-raised border border-border-subtle rounded-xl p-10 text-center mb-6">
            <div className="text-fg-tertiary mb-3">
              <Activity size={36} className="mx-auto mb-3 opacity-40" />
            </div>
            <p className="text-fg-secondary font-medium mb-1">今天暂无紧急事项</p>
            <p className="text-sm text-fg-tertiary">去和 AI 聊聊天，或创建第一个目标开始使用</p>
          </div>
        )}

        {/* ── AI 给你的提醒 ── */}
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

        {/* ── 运行状况（高级视图，默认折叠）── */}
        <div className="border-t border-border-subtle pt-4">
          <button
            onClick={() => setShowHealth(!showHealth)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-fg-tertiary hover:text-fg-secondary transition-colors"
          >
            {showHealth ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>运行状况</span>
            {!showHealth && (
              <span className="text-fg-disabled ml-1">· Token / 成本 / 数据计数 ...</span>
            )}
          </button>

          {showHealth && (
            <div className="mt-3 space-y-5">
              {/* 我的数据 */}
              {dashboard?.data_sovereignty && (
                <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={14} className="text-success" />
                    <h4 className="text-xs font-medium text-fg-secondary">我的数据</h4>
                    <span className="ml-auto text-xs text-success">全部本地存储</span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-center mb-3">
                    <div>
                      <div className="text-lg font-bold text-insight">
                        {(dashboard.data_sovereignty.total_events || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-fg-tertiary mt-0.5">事件</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-insight">
                        {(dashboard.data_sovereignty.total_memories || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-fg-tertiary mt-0.5">记忆</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-warning">
                        {(dashboard.data_sovereignty.total_goals || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-fg-tertiary mt-0.5">目标</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-insight">
                        {(dashboard.data_sovereignty.total_conversations || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-fg-tertiary mt-0.5">对话</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-fg-tertiary">
                    <span>
                      自我陈述:{" "}
                      <span className="text-insight font-medium">
                        {dashboard.data_sovereignty.memories_self_report || 0}
                      </span>
                    </span>
                    <span>
                      AI 提炼:{" "}
                      <span className="text-warning font-medium">
                        {dashboard.data_sovereignty.memories_claim || 0}
                      </span>
                    </span>
                    <span>
                      目标:{" "}
                      <span className="text-success font-medium">
                        {dashboard.data_sovereignty.goals_active || 0}
                      </span>
                      <span className="text-fg-disabled">/</span>
                      <span className="text-fg-secondary font-medium">
                        {dashboard.data_sovereignty.goals_completed || 0}
                      </span>
                    </span>
                  </div>
                </div>
              )}

              {/* AI 记住了 */}
              {memory && (
                <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
                  <h4 className="text-xs font-medium text-fg-secondary mb-3">AI 记住了</h4>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-lg font-bold text-insight">{memory.total_memories}</div>
                      <div className="text-xs text-fg-tertiary mt-0.5">条记忆</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-success">{memory.recent_7d}</div>
                      <div className="text-xs text-fg-tertiary mt-0.5">近 7 天</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-warning">
                        {Object.keys(memory.categories).length}
                      </div>
                      <div className="text-xs text-fg-tertiary mt-0.5">个分类</div>
                    </div>
                  </div>
                  {Object.keys(memory.categories).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle flex flex-wrap gap-1.5">
                      {Object.entries(memory.categories).map(([cat, count]) => (
                        <span
                          key={cat}
                          className="px-2 py-0.5 bg-surface-overlay rounded text-xs text-fg-secondary"
                        >
                          {cat}: {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* LLM / 系统指标 */}
              <div className="grid grid-cols-3 gap-3">
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

              {/* Token / 成本 */}
              <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
                <div className="text-xs text-fg-tertiary mb-3">Token 与成本 (7天)</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-fg-tertiary">总 Token</span>
                    <span className="text-fg-secondary font-mono">
                      {totalTokens.toLocaleString()}
                    </span>
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

              {/* 工具调用 */}
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
