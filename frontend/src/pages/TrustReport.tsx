import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  Database,
  Cpu,
  Activity,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Brain,
  MessageSquare,
  Target,
  FileText,
  Download,
} from "lucide-react";
import { retryMemoryIndexRepair } from "../api/telemetry";
import type { TrustReportData } from "../api/trustReport";
import { useTrustReportQuery } from "../hooks/useTrustReportQuery";
import { queryKeys } from "../hooks/useWsInvalidationBridge";
import LoadErrorNotice, { useHeldQueryError } from "../components/ui/LoadErrorNotice";
import { AdoptionSummaryView, formatAdoptionRate } from "../components/dashboard/AdoptionSummary";

const FLOW_COLORS: Record<string, string> = {
  对话: "text-insight",
  任务: "text-insight",
  定时任务: "text-warning",
  测试: "text-fg-tertiary",
  系统: "text-success",
};

/** 待审批行只在已有 id 时打开审批页。空白 id 与 correlation_id 都不编造链接。 */
function approvalsHref(id: string | null | undefined): "/approvals" | null {
  return id?.trim() ? "/approvals" : null;
}

interface RepairHandoff {
  id: number;
  /** 成功后要落到的下一条；失败或这一条还在时仍是刚才这一条。没有可落的按钮则为 null。 */
  targetId: number | null;
}

/** 绘制前通知。测试在这一条卸下的同一轮读取焦点。 */
export const trustReportLayoutFocus = {
  notify: null as null | (() => void),
};

/** 焦点在页面空白处，或还停在这次点的按钮上，才可以把焦点挪走。 */
function focusIsIdle(repairId: number): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return (
    active instanceof HTMLButtonElement &&
    active.getAttribute("data-repair-id") === String(repairId)
  );
}

function focusRetry(id: number): boolean {
  for (const node of document.querySelectorAll<HTMLButtonElement>("button[data-repair-id]")) {
    if (node.getAttribute("data-repair-id") !== String(id) || node.disabled) continue;
    node.focus();
    return document.activeElement === node;
  }
  return false;
}

function focusDashboardBack(): boolean {
  const node = document.querySelector<HTMLButtonElement>("[data-dashboard-back]");
  if (!node || node.disabled) return false;
  node.focus();
  return document.activeElement === node;
}

function freshFailedIds(queryClient: ReturnType<typeof useQueryClient>): number[] | null {
  const cached = queryClient.getQueryData<TrustReportData>(queryKeys.trustReport);
  if (!cached?.memoryIndexRepairs) return null;
  return cached.memoryIndexRepairs.items
    .filter((row) => row.status === "failed_permanent")
    .map((row) => row.id);
}

/** Trust report content — embedded as a Dashboard tab; also used by tests. */
export function TrustReportPanel({ compact = false }: { compact?: boolean }) {
  const {
    data,
    isLoading: loading,
    isFetching,
    error: queryError,
    refetch,
  } = useTrustReportQuery();
  const shownLoadError = useHeldQueryError(
    Boolean(data),
    queryError,
    isFetching,
    "加载信任报告失败",
    "trust-report",
  );
  const queryClient = useQueryClient();
  const retryingRef = useRef(new Set<number>());
  const [retryingIds, setRetryingIds] = useState<Set<number>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const focusAfter = useRef<RepairHandoff | null>(null);
  const failedRepairs =
    data?.memoryIndexRepairs?.items.filter((row) => row.status === "failed_permanent") ?? [];
  const failedRepairCount = data?.memoryIndexRepairs?.failed_permanent ?? failedRepairs.length;
  const repairKey = failedRepairs.map((row) => row.id).join("\0");

  const publishRetrying = () => {
    setRetryingIds(new Set(retryingRef.current));
  };

  // 这一条离开失败列表后才交焦点。放到绘制前，不把焦点留在页面空白。
  // 已经移到别的控件上就不再抢。
  useLayoutEffect(() => {
    const pending = focusAfter.current;
    if (!pending || retryingIds.has(pending.id)) return;
    if (!focusIsIdle(pending.id)) {
      focusAfter.current = null;
      return;
    }
    if (pending.targetId != null && focusRetry(pending.targetId)) {
      focusAfter.current = null;
      return;
    }
    const listed =
      pending.targetId != null && repairKey.split("\0").includes(String(pending.targetId));
    if (listed) return;
    focusDashboardBack();
    focusAfter.current = null;
  }, [retryingIds, repairKey]);

  useLayoutEffect(() => {
    trustReportLayoutFocus.notify?.();
  });

  const handleRetryRepair = async (repairId: number) => {
    if (retryingRef.current.has(repairId)) return;
    retryingRef.current.add(repairId);
    publishRetrying();
    const order = failedRepairs.map((row) => row.id);
    focusAfter.current = { id: repairId, targetId: repairId };
    setActionError(null);
    let failed = false;
    try {
      await retryMemoryIndexRepair(repairId);
      try {
        await queryClient.invalidateQueries({ queryKey: queryKeys.trustReport });
      } catch {
        // 写已经成功。列表没刷新时这一条还在，焦点留在按钮上。
      }
    } catch (e: unknown) {
      failed = true;
      setActionError(e instanceof Error ? e.message : "重试索引修复失败");
    } finally {
      if (!failed && focusAfter.current?.id === repairId) {
        const fresh = freshFailedIds(queryClient);
        if (!fresh || fresh.includes(repairId)) {
          focusAfter.current = { id: repairId, targetId: repairId };
        } else {
          const index = order.indexOf(repairId);
          const next = order.slice(index + 1).find((id) => fresh.includes(id)) ?? null;
          const prev =
            order
              .slice(0, index)
              .reverse()
              .find((id) => fresh.includes(id)) ?? null;
          focusAfter.current = { id: repairId, targetId: next ?? prev };
        }
      }
      retryingRef.current.delete(repairId);
      publishRetrying();
    }
  };

  if (shownLoadError) {
    return (
      <LoadErrorNotice
        message={shownLoadError}
        busy={isFetching}
        onRetry={() => {
          setActionError(null);
          void refetch();
        }}
        testId="trust-report-load-error"
      />
    );
  }

  if (loading || !data) {
    return (
      <div className={`flex items-center justify-center ${compact ? "py-16" : "h-full"}`}>
        <div className="flex flex-col items-center gap-3 text-fg-secondary">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-sm">正在生成信任报告…</p>
        </div>
      </div>
    );
  }

  const sov = data?.dashboard?.data_sovereignty;
  const pendingCount = data?.approvals?.length ?? 0;
  const tc = data?.cost?.total_calls ?? 0;
  const tcost = data?.cost?.total_cost ?? 0;
  const alat = data?.cost?.avg_latency_ms ?? 0;
  const fc = data?.cost?.failed_calls ?? 0;
  const rate = tc > 0 ? Math.round(((tc - fc) / tc) * 100) : 100;

  return (
    <div className={compact ? "" : "h-full overflow-y-auto"}>
      {!compact && (
        <div className="border-b border-border-subtle p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-insight/15">
              <Shield size={22} className="text-insight" />
            </div>
            <div>
              <h1 className="page-title text-xl">信任报告</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                了解 AI 如何使用你的数据，确保一切可审计、可追溯
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={compact ? "space-y-8" : "p-6 space-y-8"}>
        {compact && (
          <p className="text-sm text-fg-tertiary">
            了解 AI 如何使用你的数据，确保一切可审计、可追溯
          </p>
        )}

        {actionError && data && (
          <div className="flex items-center gap-2 text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
            <AlertCircle size={14} />
            {actionError}
          </div>
        )}

        {/* 数据存储位置 */}
        <section>
          <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
            <Database size={20} className="text-insight" />
            数据存储位置
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Kv
              icon={Database}
              label="存储位置"
              value="本地 (SQLite + Chroma)"
              color="text-insight"
              sub="数据永不出本机"
            />
            <Kv
              icon={FileText}
              label="事件日志"
              value={`${sov?.total_events ?? data?.system?.event_log ?? 0} 条`}
              color="text-warning"
              sub="append-only · 不可改写"
            />
            <Kv
              icon={MessageSquare}
              label="对话数"
              value={`${data?.system?.conversations ?? 0}`}
              color="text-insight"
              sub={`${data?.system?.messages ?? 0} 条消息`}
            />
            <Kv
              icon={Brain}
              label="记忆"
              value={`${data?.system?.memories ?? 0} 条`}
              color="text-insight"
              sub={`${data?.memory?.recent_7d ?? 0} 条近 7 天`}
            />
            <Kv
              icon={Target}
              label="目标"
              value={`${sov?.goals_active ?? 0} 活跃 / ${sov?.total_goals ?? data?.system?.goals ?? 0} 总计`}
              color="text-success"
              sub={`${sov?.goals_completed ?? 0} 已完成`}
            />
            <Kv
              icon={Download}
              label="数据导出"
              value="支持完整导出"
              color="text-insight"
              sub="一键导出 JSON"
            />
          </div>
        </section>

        {/* AI 做了什么 */}
        <section>
          <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
            <Activity size={20} className="text-warning" />
            AI 做了什么
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Kv
              icon={Cpu}
              label="LLM 调用 (7天)"
              value={`${tc} 次`}
              color="text-insight"
              sub={`成功率 ${rate}%`}
            />
            <Kv
              icon={Activity}
              label="总成本"
              value={`$${tcost.toFixed(4)}`}
              color="text-warning"
              sub={`平均 ${alat.toFixed(0)}ms`}
            />
            <Kv
              icon={Target}
              label="工具调用"
              value={`${data?.tools?.reduce((s, t) => s + (t.total_calls || 0), 0) ?? 0} 次`}
              color="text-insight"
              sub={`${data?.tools?.length ?? 0} 种工具`}
            />
            <Kv
              icon={AlertTriangle}
              label="进行中工作项"
              value={`${data?.health?.active_work_items ?? 0} 个`}
              color="text-warning"
              sub={`LLM 失败率 ${((data?.health?.llm_failure_rate_24h ?? 0) * 100).toFixed(1)}%`}
            />
          </div>
          {(data?.costByModel?.length ?? 0) > 0 && (
            <div className="bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4">
              <h3 className="text-sm font-medium text-fg-primary mb-3">按模型拆分</h3>
              <div className="space-y-2">
                {data!.costByModel.map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-fg-secondary">
                      {m.provider}/{m.model}
                    </span>
                    <div className="flex items-center gap-4">
                      <span className="text-fg-tertiary text-xs">{m.total_calls} 次</span>
                      <span className="text-fg-secondary">${m.cost.toFixed(4)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 记忆索引修复 */}
        {failedRepairCount > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
              <AlertCircle size={20} className="text-danger" />
              记忆索引修复失败
              <span className="text-xs bg-danger/20 text-danger px-2 py-0.5 rounded-full">
                {failedRepairCount}
              </span>
            </h2>
            <div className="space-y-2">
              {failedRepairs.map((repair) => (
                <div
                  key={repair.id}
                  className="flex items-start gap-3 bg-danger/10 border border-danger/30 rounded-xl p-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg-primary font-mono truncate">
                      {repair.aggregate_id}
                    </p>
                    <p className="text-xs text-fg-secondary mt-1">
                      {repair.event_type} · seq {repair.event_seq} · 已重试 {repair.retry_count} 次
                    </p>
                    {repair.error && (
                      <p className="text-xs text-danger mt-2 break-words">{repair.error}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="重试索引"
                    data-repair-id={repair.id}
                    aria-busy={retryingIds.has(repair.id) || undefined}
                    onClick={() => void handleRetryRepair(repair.id)}
                    className={`shrink-0 px-3 py-1.5 text-xs bg-danger/20 text-danger rounded-lg hover:bg-danger/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                      retryingIds.has(repair.id) ? " opacity-50" : ""
                    }`}
                  >
                    {retryingIds.has(repair.id) ? "重试中…" : "重试索引"}
                  </button>
                </div>
              ))}
            </div>
            {(data?.memoryIndexRepairs?.pending ?? 0) > 0 && (
              <p className="text-xs text-fg-tertiary mt-3">
                另有 {data!.memoryIndexRepairs.pending} 条修复任务排队中
              </p>
            )}
          </section>
        )}

        {/* 需要审批 */}
        <section>
          <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
            <AlertTriangle size={20} className="text-warning" />
            需要审批
            {pendingCount > 0 && (
              <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </h2>
          {pendingCount === 0 ? (
            <div className="bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-6 text-center">
              <Shield size={24} className="text-success mx-auto mb-2" />
              <p className="text-sm text-fg-secondary">没有等待审批的操作</p>
              <p className="text-xs text-fg-tertiary mt-1">AI 没有背着你做任何需要你确认的事</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data!.approvals.map((a, index) => {
                const flowColor = FLOW_COLORS[a.flow_type] ?? "text-fg-secondary";
                const flowLabel = a.flow_type;
                const href = approvalsHref(a.id);
                const actionLabel = a.action ?? "未知操作";
                return (
                  <div
                    key={a.id?.trim() || `blank-${index}`}
                    className="flex items-center gap-3 bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4 hover:border-border-strong transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full bg-warning shrink-0" />
                    <div className="flex-1 min-w-0">
                      {href ? (
                        <Link
                          to={href}
                          title="打开审批"
                          className="block rounded-sm text-sm text-fg-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                        >
                          <span className="block truncate">{actionLabel}</span>
                        </Link>
                      ) : (
                        <p className="text-sm text-fg-primary truncate">{actionLabel}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs ${flowColor}`}>{flowLabel}</span>
                        {a.flow_label && (
                          <span className="text-xs text-fg-tertiary truncate">{a.flow_label}</span>
                        )}
                      </div>
                    </div>
                    {a.expires_at && (
                      <span className="text-xs text-fg-tertiary shrink-0">
                        过期: {new Date(a.expires_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 治理活动统计 (7天) */}
        {data?.governance &&
          (() => {
            const g = data.governance;
            const topTools = Object.entries(g.by_tool || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6);
            const deniedTools = Object.entries(g.denied_tools || {});
            return (
              <section>
                <h2 className="text-lg font-semibold text-fg-primary mb-4 flex items-center gap-2">
                  <Shield size={20} className="text-insight" />
                  治理活动（近 {g.window_days} 天）
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <Kv
                    icon={Activity}
                    label="工具调用"
                    value={`${g.tools_invoked}`}
                    color="text-insight"
                  />
                  <Kv
                    icon={AlertTriangle}
                    label="被拦截"
                    value={`${g.tools_denied}`}
                    color="text-danger"
                    sub="高风险写操作"
                  />
                  <Kv
                    icon={Shield}
                    label="提交审批"
                    value={`${g.tools_deferred}`}
                    color="text-warning"
                    sub={
                      g.adoption
                        ? `采纳率 ${formatAdoptionRate(g.adoption.suggestions.adoption_rate)} · ${g.approvals_approved} 通过 / ${g.approvals_rejected} 拒绝`
                        : `${g.approvals_approved} 通过 / ${g.approvals_rejected} 拒绝`
                    }
                  />
                  <Kv
                    icon={AlertCircle}
                    label="Taint 升级"
                    value={`${g.taint_elevated}`}
                    color="text-warning"
                    sub="外部内容污染链"
                  />
                </div>
                {(topTools.length > 0 || deniedTools.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {topTools.length > 0 && (
                      <div className="bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-fg-primary mb-3">最常用工具</h3>
                        <div className="space-y-1.5">
                          {topTools.map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between text-xs">
                              <span className="text-fg-secondary truncate">{name}</span>
                              <span className="text-fg-secondary">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {deniedTools.length > 0 && (
                      <div className="bg-surface-overlay/50 border border-danger/30 rounded-xl p-4">
                        <h3 className="text-sm font-medium text-danger mb-3">被拦截工具</h3>
                        <div className="space-y-1.5">
                          {deniedTools.map(([name, count]) => (
                            <div key={name} className="flex items-center justify-between text-xs">
                              <span className="text-fg-secondary truncate">{name}</span>
                              <span className="text-danger">{count} 次拦截</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {g.adoption && (
                  <div className="mt-4">
                    <AdoptionSummaryView adoption={g.adoption} />
                  </div>
                )}
                {g.tools_invoked === 0 && (
                  <p className="text-sm text-fg-tertiary">近期无工具调用记录</p>
                )}
              </section>
            );
          })()}
      </div>
    </div>
  );
}

function Kv({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-surface-overlay/50 border border-border-strong/50 rounded-xl p-4 hover:border-border-strong transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={18} className={color} />
        <h3 className="text-xs text-fg-tertiary">{label}</h3>
      </div>
      <p className="text-xl font-semibold text-fg-primary">{value}</p>
      {sub && <p className="text-xs text-fg-tertiary mt-1">{sub}</p>}
    </div>
  );
}
