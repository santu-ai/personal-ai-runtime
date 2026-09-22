import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  acceptWorkDelivery,
  adoptSuggestedAction,
  cancelWorkItem,
  createProjectBrief,
  executeWorkItem,
  getDeliveryMetrics,
  getWorkDelivery,
  reworkWorkDelivery,
  updateWorkItemStatus,
  type WorkDelivery,
  type DeliveryMetrics,
  type WorkItem,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useInvalidateTasks, useTaskDetailQuery, useTasksQuery } from "../hooks/useTasksQuery";
import Button from "../components/ui/Button";
import Dialog from "../components/ui/Dialog";
import Disclosure from "../components/ui/Disclosure";
import EmptyState from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import PageHeader from "../components/ui/PageHeader";
import { timeAgo } from "../utils/timeUtils";
import { toolLabel } from "../utils/toolLabels";
import { ListTodo } from "lucide-react";

const ACTIVE_STATUSES = new Set(["pending", "running", "blocked", "waiting_approval"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const OUTPUT_PREVIEW = 240;

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "待执行",
    running: "运行中",
    blocked: "阻塞",
    waiting_approval: "待审批",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status] || status;
}

function statusClass(status: string): string {
  if (status === "running") return "text-insight";
  if (status === "failed") return "text-danger";
  if (status === "completed") return "text-success";
  if (status === "cancelled") return "text-fg-tertiary";
  if (status === "waiting_approval") return "text-warning";
  return "text-fg-secondary";
}

function reviewLabel(status: string | null | undefined): string {
  if (status === "accepted") return "已验收";
  if (status === "changes_requested") return "已要求返工";
  if (status === "unreviewed") return "待验收";
  return "无交付";
}

function stepToolName(step: Record<string, unknown>): string {
  const tool = step.tool ?? step.name ?? step.action;
  return typeof tool === "string" ? tool : "step";
}

function formatStepLabel(step: Record<string, unknown>): string {
  const name = stepToolName(step);
  return name === "step" ? "step" : toolLabel(name);
}

function truncateOutput(value: unknown): string {
  const text =
    typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 0);
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= OUTPUT_PREVIEW) return collapsed;
  return `${collapsed.slice(0, OUTPUT_PREVIEW - 1)}…`;
}

function formatPlanConfirmDescription(
  steps: Array<Record<string, unknown>>,
  resumeFrom: number,
): string {
  if (steps.length === 0) {
    return "将启动该任务的可执行计划。";
  }
  const lines = steps.map((step, idx) => {
    const mark = idx < resumeFrom ? "✓" : idx === resumeFrom ? "→" : "·";
    return `${mark} ${idx + 1}. ${formatStepLabel(step)}`;
  });
  const start = Math.min(resumeFrom, steps.length - 1) + 1;
  return `将从第 ${start} / ${steps.length} 步开始执行：\n${lines.join("\n")}`;
}

function planObject(item: WorkItem | null | undefined): Record<string, unknown> | null {
  const raw = item?.executable_plan;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isProjectBrief(item: WorkItem | null | undefined): boolean {
  const plan = planObject(item);
  if (plan?.kind === "project_brief" || plan?.kind === "adopted_suggestion") {
    return plan.kind === "project_brief";
  }
  return (item?.executable_plan || "").includes("project_brief");
}

function isAdoptedSuggestion(item: WorkItem | null | undefined): boolean {
  return planObject(item)?.kind === "adopted_suggestion";
}

function taskKindLabel(item: WorkItem): string {
  if (isProjectBrief(item)) return "项目简报";
  if (isAdoptedSuggestion(item)) return "来自简报";
  if (item.work_type === "background") return "后台";
  return "任务";
}

function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatAcceptanceRate(metrics: DeliveryMetrics): string {
  if (metrics.first_version_acceptance_rate == null) return "尚无首次评审";
  const percent = Math.round(metrics.first_version_acceptance_rate * 100);
  return `${percent}%（${metrics.first_version_accepted_tasks}/${metrics.first_reviewed_tasks}）`;
}

function formatAttributedCount(value: number | "unavailable", label: string): string {
  return value === "unavailable" ? `${label}未分开计` : `${label} ${value}`;
}

function formatAttributedCost(value: number | "unavailable"): string {
  return value === "unavailable" ? "模型成本未分开计" : `模型成本 $${value.toFixed(4)}`;
}

function hasDeliveryMetrics(metrics: DeliveryMetrics | null): metrics is DeliveryMetrics {
  return Boolean(metrics && (metrics.reviewed_tasks > 0 || metrics.adopted_action_count > 0));
}

export default function TasksPage() {
  const { taskId: urlTaskId } = useParams();
  const navigate = useNavigate();
  const { data: items = [], error: listError, isLoading } = useTasksQuery();
  const {
    data: selected,
    error: detailError,
    isError: detailIsError,
  } = useTaskDetailQuery(urlTaskId);
  const invalidate = useInvalidateTasks();
  const addError = useErrorStore((s) => s.addError);
  const [busy, setBusy] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailQuery, setEmailQuery] = useState("");
  const [emailDays, setEmailDays] = useState("3");
  const [filePaths, setFilePaths] = useState("");
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkReason, setReworkReason] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyFull, setHistoryFull] = useState<WorkDelivery | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DeliveryMetrics | null>(null);
  const [metricsRefresh, setMetricsRefresh] = useState(0);
  const executeInFlight = useRef(false);
  const acceptKey = useRef<string | null>(null);
  const adoptKeys = useRef<Record<number, string>>({});

  const notFound =
    Boolean(urlTaskId) &&
    detailIsError &&
    detailError instanceof ApiError &&
    detailError.status === 404;

  useEffect(() => {
    setConfirmExecute(false);
    setReworkOpen(false);
    setReworkReason("");
    setHistoryId(null);
    setHistoryFull(null);
    setHistoryError(null);
    setHistoryLoading(false);
    acceptKey.current = null;
    adoptKeys.current = {};
  }, [urlTaskId]);

  useEffect(() => {
    if (!urlTaskId || !historyId) {
      setHistoryFull(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryFull(null);
    void getWorkDelivery(urlTaskId, historyId)
      .then((row) => {
        if (!cancelled) {
          setHistoryFull(row);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHistoryFull(null);
          setHistoryError(err instanceof ApiError ? err.message : "加载历史版本失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [urlTaskId, historyId]);

  useEffect(() => {
    if (listError) {
      addError(listError instanceof ApiError ? listError.message : "加载任务失败", "任务");
    }
  }, [listError, addError]);

  useEffect(() => {
    if (detailError && !(detailError instanceof ApiError && detailError.status === 404)) {
      addError(detailError instanceof ApiError ? detailError.message : "加载任务详情失败", "任务");
    }
  }, [detailError, addError]);

  useEffect(() => {
    let cancelled = false;
    void getDeliveryMetrics(30)
      .then((value) => {
        if (!cancelled) setMetrics(value);
      })
      .catch(() => {
        if (!cancelled) setMetrics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [metricsRefresh]);

  const grouped = useMemo(() => {
    const active: WorkItem[] = [];
    const terminal: WorkItem[] = [];
    for (const item of items) {
      if (ACTIVE_STATUSES.has(item.status)) active.push(item);
      else terminal.push(item);
    }
    return { active, terminal };
  }, [items]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !objective.trim()) return;
    setBusy(true);
    try {
      const files = filePaths
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((path) => ({ path }));
      const item = await createProjectBrief({
        title: newTitle.trim(),
        objective: objective.trim(),
        source_scope: {
          email: {
            enabled: emailEnabled,
            query: emailQuery.trim(),
            days: Math.max(0, Number(emailDays) || 3),
          },
          files,
        },
      });
      setShowCreate(false);
      setNewTitle("");
      setObjective("");
      setEmailQuery("");
      setFilePaths("");
      invalidate();
      navigate(`/tasks/${item.id}`);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建任务失败", "任务");
    } finally {
      setBusy(false);
    }
  };

  const handleExecute = async () => {
    if (!selected || executeInFlight.current) return;
    executeInFlight.current = true;
    setBusy(true);
    setConfirmExecute(false);
    try {
      await executeWorkItem(selected.id);
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "启动任务失败", "任务");
    } finally {
      executeInFlight.current = false;
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await cancelWorkItem(selected.id);
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "取消任务失败", "任务");
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (delivery: WorkDelivery) => {
    if (!selected) return;
    setBusy(true);
    if (!acceptKey.current) acceptKey.current = newIdempotencyKey("accept");
    try {
      await acceptWorkDelivery(selected.id, delivery.delivery_id, {
        idempotency_key: acceptKey.current,
      });
      invalidate();
      setMetricsRefresh((value) => value + 1);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "验收失败", "任务");
    } finally {
      setBusy(false);
    }
  };

  const handleAdopt = async (delivery: WorkDelivery, actionIndex: number) => {
    if (!selected) return;
    setBusy(true);
    if (!adoptKeys.current[actionIndex]) {
      adoptKeys.current[actionIndex] = newIdempotencyKey("adopt");
    }
    try {
      await adoptSuggestedAction(selected.id, delivery.delivery_id, actionIndex, {
        idempotency_key: adoptKeys.current[actionIndex],
      });
      invalidate();
      setMetricsRefresh((value) => value + 1);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "转为任务失败", "任务");
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await updateWorkItemStatus(selected.id, "completed");
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "完成任务失败", "任务");
    } finally {
      setBusy(false);
    }
  };

  const handleRework = async () => {
    if (!selected) return;
    const current = selected.delivery_bundle?.current;
    if (!current || !reworkReason.trim()) return;
    setBusy(true);
    try {
      await reworkWorkDelivery(selected.id, current.delivery_id, {
        reason: reworkReason.trim(),
        idempotency_key: newIdempotencyKey("rework"),
      });
      setReworkOpen(false);
      setReworkReason("");
      invalidate();
      setMetricsRefresh((value) => value + 1);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "返工失败", "任务");
    } finally {
      setBusy(false);
    }
  };

  const renderList = (list: WorkItem[], empty: string) => {
    if (list.length === 0) {
      return <p className="text-sm text-fg-tertiary px-1 py-2">{empty}</p>;
    }
    return (
      <ul className="space-y-1">
        {list.map((item) => {
          const active = item.id === urlTaskId;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate(`/tasks/${item.id}`)}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  active
                    ? "border-insight/40 bg-insight/10"
                    : "border-border-subtle bg-surface-raised shadow-sm hover:border-border-strong hover:bg-surface-hover/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg-primary truncate">{item.title}</span>
                  <span className={`text-xs shrink-0 ${statusClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
                  <span>{taskKindLabel(item)}</span>
                  <span>·</span>
                  <span>{timeAgo(item.updated_at || item.created_at)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  const execution = selected?.execution;
  const steps = execution?.steps ?? [];
  const resumeFrom = execution?.resume_from ?? 0;
  const previousOutput = execution?.previous_output ?? {};
  const outputEntries = Object.entries(previousOutput).filter(
    ([, v]) => v !== undefined && v !== null && String(v).length > 0,
  );
  const handler = execution?.handler_execution;
  const executionFailed = handler?.status === "failed" || Boolean(handler?.dead_letter);
  const canExecute =
    selected &&
    !isAdoptedSuggestion(selected) &&
    Boolean(selected.executable_plan) &&
    selected.status !== "waiting_approval" &&
    selected.status !== "cancelled" &&
    selected.status !== "completed" &&
    (selected.status !== "running" || executionFailed);
  const canComplete = Boolean(
    selected && isAdoptedSuggestion(selected) && selected.status === "pending",
  );
  const canCancel =
    selected && selected.work_type === "background" && !TERMINAL_STATUSES.has(selected.status);
  const bundle = selected?.delivery_bundle;
  const currentDelivery = bundle?.current ?? null;
  const viewingHistory = Boolean(
    historyId && currentDelivery && historyId !== currentDelivery.delivery_id,
  );
  const shownDelivery = viewingHistory ? historyFull : currentDelivery;
  const detailOpen = Boolean(urlTaskId);
  const showSplit = items.length > 0 || detailOpen;

  return (
    <div className="page-shell">
      <div className="page-container">
        <PageHeader
          title="任务"
          description="交办、交付与验收"
          actions={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              新建简报
            </Button>
          }
        />

        {hasDeliveryMetrics(metrics) && (
          <section className="mb-5 space-y-1 rounded-lg border border-border-subtle px-3 py-2">
            <h2 className="text-xs font-medium text-fg-tertiary">
              近 {metrics.window_days} 日简报
            </h2>
            <p className="text-sm text-fg-primary">首版采纳 {formatAcceptanceRate(metrics)}</p>
            <p className="text-xs text-fg-secondary">
              返工 {metrics.rework_count} · 已转任务 {metrics.adopted_action_count}
              {metrics.average_review_latency_hours != null
                ? ` · 平均评审 ${metrics.average_review_latency_hours} 小时`
                : ""}
            </p>
            <p className="text-xs text-fg-tertiary">
              {formatAttributedCount(metrics.attribution.approval_interventions, "审批")}
              {" · "}
              {formatAttributedCount(metrics.attribution.recovery_interventions, "恢复")}
              {" · "}
              {formatAttributedCost(metrics.attribution.llm_cost)}
            </p>
            {metrics.capped ? (
              <p className="text-xs text-warning">窗口内事件较多，统计可能不完整</p>
            ) : null}
          </section>
        )}

        {isLoading && items.length === 0 && !detailOpen ? (
          <p className="text-sm text-fg-tertiary">加载中…</p>
        ) : showSplit ? (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <section
              aria-label="任务列表"
              className={detailOpen ? "hidden min-w-0 lg:block" : "min-w-0"}
            >
              {isLoading && items.length === 0 ? (
                <p className="text-sm text-fg-tertiary">加载中…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-fg-tertiary">暂无其他任务</p>
              ) : (
                <div className="space-y-6">
                  <section>
                    <p className="section-label mb-2 px-1">进行中</p>
                    {renderList(grouped.active, "没有进行中的任务")}
                  </section>
                  <section>
                    <p className="section-label mb-2 px-1">历史</p>
                    {renderList(grouped.terminal, "没有历史任务")}
                  </section>
                </div>
              )}
            </section>

            <section
              aria-label="任务详情"
              className={detailOpen ? "min-w-0" : "hidden min-w-0 lg:block"}
            >
              {detailOpen && !notFound && (
                <div className="mb-4 lg:hidden">
                  <Button size="sm" variant="secondary" onClick={() => navigate("/tasks")}>
                    返回列表
                  </Button>
                </div>
              )}
              {!urlTaskId && (
                <EmptyState title="选择一个任务" description="先看交付结果，再按需查看执行日志。" />
              )}
              {notFound && (
                <EmptyState
                  title="任务不存在"
                  description="该任务可能已被删除。"
                  action={
                    <Button size="sm" onClick={() => navigate("/tasks")}>
                      返回列表
                    </Button>
                  }
                />
              )}
              {urlTaskId && !selected && !notFound && (
                <p className="py-14 text-center text-sm text-fg-tertiary">加载中…</p>
              )}
              {selected && !notFound && (
                <div className="space-y-6">
                  <header className="space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-medium text-fg-primary">{selected.title}</h2>
                        <p className="text-sm text-fg-tertiary mt-1">
                          {isProjectBrief(selected)
                            ? "项目资料简报"
                            : isAdoptedSuggestion(selected)
                              ? "简报待办"
                              : selected.work_type === "background"
                                ? "后台任务"
                                : "任务"}
                          {" · "}
                          <span className={statusClass(selected.status)}>
                            {statusLabel(selected.status)}
                          </span>
                          {bundle?.current_review_status ? (
                            <>
                              {" · "}
                              <span>{reviewLabel(bundle.current_review_status)}</span>
                            </>
                          ) : null}
                          {handler?.dead_letter ? (
                            <span className="text-danger"> · 死信</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {canComplete && (
                          <Button size="sm" onClick={handleComplete} disabled={busy}>
                            完成
                          </Button>
                        )}
                        {canExecute && (
                          <Button size="sm" onClick={() => setConfirmExecute(true)} disabled={busy}>
                            {executionFailed && selected.status === "running" ? "重新执行" : "执行"}
                          </Button>
                        )}
                        {canCancel && (
                          <Button size="sm" variant="subtle" onClick={handleCancel} disabled={busy}>
                            取消
                          </Button>
                        )}
                      </div>
                    </div>
                    {selected.description && (
                      <p className="text-sm text-fg-secondary whitespace-pre-wrap">
                        {selected.description}
                      </p>
                    )}
                  </header>

                  {viewingHistory && historyLoading && (
                    <p className="text-sm text-fg-tertiary">加载历史版本全文…</p>
                  )}
                  {viewingHistory && historyError && (
                    <p className="text-sm text-danger">{historyError}</p>
                  )}
                  {shownDelivery ? (
                    <section className="space-y-3 rounded-xl border border-border-subtle p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium text-fg-primary">
                            交付 v{shownDelivery.version}
                            {viewingHistory ? "（历史版本）" : ""}
                          </h3>
                          <p className="text-xs text-fg-tertiary mt-1">
                            {reviewLabel(shownDelivery.review_status)}
                            {shownDelivery.qualified ? "" : " · 非完整合格简报"}
                          </p>
                        </div>
                        {!viewingHistory && shownDelivery.review_status === "unreviewed" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => void handleAccept(shownDelivery)}
                              disabled={busy}
                            >
                              验收
                            </Button>
                            <Button
                              size="sm"
                              variant="subtle"
                              onClick={() => setReworkOpen(true)}
                              disabled={busy}
                            >
                              返工
                            </Button>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-fg-secondary whitespace-pre-wrap">
                        {shownDelivery.summary}
                      </p>
                      <pre className="text-sm text-fg-primary whitespace-pre-wrap break-words bg-surface-sunken rounded-lg p-3">
                        {shownDelivery.content || "（正在加载完整正文）"}
                      </pre>
                      {shownDelivery.limitations.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-fg-tertiary mb-1">限制与不足</h4>
                          <ul className="text-sm text-warning space-y-1">
                            {shownDelivery.limitations.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {shownDelivery.sources.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-fg-tertiary mb-1">来源</h4>
                          <ul className="text-sm text-fg-secondary space-y-1">
                            {shownDelivery.sources.map((src) => (
                              <li key={src.id}>
                                <span className="font-mono text-xs text-fg-tertiary mr-2">
                                  {src.id}
                                </span>
                                {src.title}
                                {src.locator ? ` · ${src.locator}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {shownDelivery.suggested_actions.length > 0 && (
                        <div>
                          <h4 className="text-xs font-medium text-fg-tertiary mb-1">建议待办</h4>
                          <ul className="text-sm text-fg-secondary space-y-2">
                            {shownDelivery.suggested_actions.map((action, index) => (
                              <li
                                key={`${action.title}-${index}`}
                                className="flex items-start justify-between gap-3"
                              >
                                <span>
                                  {action.title}
                                  {action.reason ? ` — ${action.reason}` : ""}
                                </span>
                                {!viewingHistory && action.adopted_work_id ? (
                                  <Button
                                    size="sm"
                                    variant="subtle"
                                    onClick={() => navigate(`/tasks/${action.adopted_work_id}`)}
                                  >
                                    已转为任务
                                  </Button>
                                ) : !viewingHistory ? (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleAdopt(shownDelivery, index)}
                                    disabled={busy}
                                  >
                                    转为任务
                                  </Button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  ) : isProjectBrief(selected) ? (
                    <p className="text-sm text-fg-tertiary">
                      {selected.status === "failed" || executionFailed
                        ? "执行失败，尚未发布合格交付。可查看执行日志后重试。"
                        : "还没有交付结果。确认资料范围后执行任务。"}
                    </p>
                  ) : executionFailed && selected.status === "running" ? (
                    <p className="text-sm text-danger">
                      上次执行已失败，任务仍显示为进行中。可以重新执行。
                    </p>
                  ) : null}

                  {bundle && bundle.deliveries.length > 1 && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-medium text-fg-primary">版本历史</h3>
                      <ul className="space-y-1">
                        {bundle.deliveries.map((row) => (
                          <li key={row.delivery_id}>
                            <button
                              type="button"
                              className="text-sm text-insight hover:underline"
                              onClick={() =>
                                setHistoryId(
                                  row.delivery_id === currentDelivery?.delivery_id
                                    ? null
                                    : row.delivery_id,
                                )
                              }
                            >
                              v{row.version} · {reviewLabel(row.review_status)} ·{" "}
                              {row.summary || "无摘要"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <Disclosure
                    title="执行日志"
                    description="计划、步骤输出与事件"
                    defaultOpen={!shownDelivery}
                  >
                    <div className="space-y-4">
                      <section className="space-y-2">
                        <h3 className="text-sm font-medium text-fg-primary">执行计划</h3>
                        {steps.length === 0 ? (
                          <p className="text-sm text-fg-tertiary">无 executable_plan</p>
                        ) : (
                          <ol className="space-y-2">
                            {steps.map((step, idx) => {
                              const done = idx < resumeFrom;
                              const current = idx === resumeFrom && selected.status === "running";
                              return (
                                <li
                                  key={idx}
                                  className={`rounded-lg border px-3 py-2 text-sm ${
                                    done
                                      ? "border-success/30 bg-success/5 text-fg-secondary"
                                      : current
                                        ? "border-insight/40 bg-insight/5 text-fg-primary"
                                        : "border-border-subtle text-fg-secondary"
                                  }`}
                                >
                                  <span className="text-xs text-fg-tertiary mr-2">#{idx + 1}</span>
                                  <span className="font-medium">{formatStepLabel(step)}</span>
                                  {done && (
                                    <span className="ml-2 text-xs text-success">已完成</span>
                                  )}
                                  {current && (
                                    <span className="ml-2 text-xs text-insight">当前</span>
                                  )}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </section>

                      {outputEntries.length > 0 && (
                        <section className="space-y-2">
                          <h3 className="text-sm font-medium text-fg-primary">
                            最近一步输出（预览）
                          </h3>
                          <ul className="space-y-2">
                            {outputEntries.map(([key, value]) => (
                              <li
                                key={key}
                                className="rounded-lg border border-border-subtle px-3 py-2 text-sm"
                              >
                                <div className="text-xs text-fg-tertiary mb-1 font-mono">{key}</div>
                                <pre className="text-fg-secondary whitespace-pre-wrap break-all text-xs">
                                  {truncateOutput(value)}
                                </pre>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      {handler && (
                        <section className="space-y-1 text-sm">
                          <h3 className="text-sm font-medium text-fg-primary">执行状态</h3>
                          <p className="text-fg-secondary">
                            handler: {handler.handler_name || "—"} · {handler.status}
                            {handler.dead_letter ? " · dead_letter" : ""}
                            {handler.retry_count > 0 ? ` · 重试 ${handler.retry_count}` : ""}
                          </p>
                        </section>
                      )}

                      {selected.events && selected.events.length > 0 && (
                        <section className="space-y-2">
                          <h3 className="text-sm font-medium text-fg-primary">最近事件</h3>
                          <ul className="space-y-1 text-sm text-fg-secondary">
                            {selected.events.map((ev, i) => (
                              <li key={i} className="border-b border-border-subtle py-1.5">
                                <span className="text-fg-tertiary text-xs mr-2">
                                  {ev.timestamp ? timeAgo(ev.timestamp) : ""}
                                </span>
                                {ev.summary || ev.type || "事件"}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  </Disclosure>
                </div>
              )}
            </section>
          </div>
        ) : (
          <EmptyState
            icon={<ListTodo className="h-8 w-8" />}
            title="暂无任务"
            description="从项目资料简报开始：交办后可验收或返工。"
          />
        )}

        <Dialog
          open={confirmExecute && Boolean(selected && canExecute)}
          title="确认执行计划"
          description={formatPlanConfirmDescription(steps, resumeFrom)}
          confirmLabel="确认执行"
          cancelLabel="取消"
          confirmDisabled={busy}
          onConfirm={() => {
            void handleExecute();
          }}
          onCancel={() => setConfirmExecute(false)}
        />

        <Dialog
          open={showCreate}
          title="新建项目资料简报"
          description="指定资料范围、时间范围和验收要求。原始需求会保留在任务说明中。"
          confirmLabel="创建"
          cancelLabel="取消"
          confirmDisabled={busy || !newTitle.trim() || !objective.trim()}
          onConfirm={() => {
            void handleCreate();
          }}
          onCancel={() => setShowCreate(false)}
        >
          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">标题</span>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="项目 A 简报"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">目标与验收要求</span>
              <textarea
                className="w-full min-h-24 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="整理最近三天的邮件和指定资料，列出变化、风险和建议待办。每条关键结论附来源。"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
              />
              <span>读取已配置邮箱</span>
            </label>
            {emailEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={emailQuery}
                  onChange={(e) => setEmailQuery(e.target.value)}
                  placeholder="关键词（可选）"
                />
                <Input
                  value={emailDays}
                  onChange={(e) => setEmailDays(e.target.value)}
                  placeholder="最近天数"
                />
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">资料路径（每行一个）</span>
              <textarea
                className="w-full min-h-16 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
                value={filePaths}
                onChange={(e) => setFilePaths(e.target.value)}
                placeholder="C:\notes\project-a.md"
              />
            </label>
          </div>
        </Dialog>

        <Dialog
          open={reworkOpen}
          title="请求返工"
          description="请填写修改意见。旧版交付会保留，新执行使用原要求与本意见。"
          confirmLabel="确认返工"
          cancelLabel="取消"
          confirmDisabled={busy || !reworkReason.trim()}
          onConfirm={() => {
            void handleRework();
          }}
          onCancel={() => setReworkOpen(false)}
        >
          <textarea
            className="w-full min-h-24 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
            value={reworkReason}
            onChange={(e) => setReworkReason(e.target.value)}
            placeholder="例如：补上风险，并给每条结论带来源。"
          />
        </Dialog>
      </div>
    </div>
  );
}
