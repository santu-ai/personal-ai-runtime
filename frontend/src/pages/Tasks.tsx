import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  cancelWorkItem,
  executeWorkItem,
  type WorkItem,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useInvalidateTasks, useTaskDetailQuery, useTasksQuery } from "../hooks/useTasksQuery";
import Button from "../components/ui/Button";
import Dialog from "../components/ui/Dialog";
import EmptyState from "../components/ui/EmptyState";
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
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value, null, 0);
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

  const notFound =
    Boolean(urlTaskId) &&
    detailIsError &&
    detailError instanceof ApiError &&
    detailError.status === 404;

  useEffect(() => {
    setConfirmExecute(false);
  }, [urlTaskId]);

  useEffect(() => {
    if (listError) {
      addError(listError instanceof ApiError ? listError.message : "加载任务失败", "任务");
    }
  }, [listError, addError]);

  useEffect(() => {
    if (detailError && !(detailError instanceof ApiError && detailError.status === 404)) {
      addError(
        detailError instanceof ApiError ? detailError.message : "加载任务详情失败",
        "任务",
      );
    }
  }, [detailError, addError]);

  const grouped = useMemo(() => {
    const active: WorkItem[] = [];
    const terminal: WorkItem[] = [];
    for (const item of items) {
      if (ACTIVE_STATUSES.has(item.status)) active.push(item);
      else terminal.push(item);
    }
    return { active, terminal };
  }, [items]);

  const handleExecute = async () => {
    if (!selected) return;
    setBusy(true);
    setConfirmExecute(false);
    try {
      await executeWorkItem(selected.id);
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "启动任务失败", "任务");
    } finally {
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
                className={`w-full text-left rounded-lg px-3 py-2 border transition-colors ${
                  active
                    ? "bg-surface-raised border-border-strong"
                    : "bg-transparent border-transparent hover:bg-surface-raised/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg-primary truncate">{item.title}</span>
                  <span className={`text-xs shrink-0 ${statusClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
                  <span>{item.work_type === "background" ? "后台" : "任务"}</span>
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
  const canExecute =
    selected &&
    Boolean(selected.executable_plan) &&
    !TERMINAL_STATUSES.has(selected.status) &&
    selected.status !== "running" &&
    selected.status !== "waiting_approval";
  const canCancel =
    selected &&
    selected.work_type === "background" &&
    !TERMINAL_STATUSES.has(selected.status);

  return (
    <div className="flex-1 flex min-h-0">
      <aside className="w-72 shrink-0 border-r border-border-subtle overflow-y-auto p-4 space-y-6">
        <div>
          <h1 className="text-lg font-medium text-fg-primary">任务</h1>
          <p className="text-xs text-fg-tertiary mt-1">后台与可执行任务</p>
        </div>
        {isLoading ? (
          <p className="text-sm text-fg-tertiary">加载中…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ListTodo className="w-8 h-8" />}
            title="暂无任务"
            description="后台任务与可执行计划会出现在这里。"
          />
        ) : (
          <>
            <section>
              <h2 className="text-xs font-medium text-fg-tertiary uppercase tracking-wide mb-2">
                进行中
              </h2>
              {renderList(grouped.active, "没有进行中的任务")}
            </section>
            <section>
              <h2 className="text-xs font-medium text-fg-tertiary uppercase tracking-wide mb-2">
                历史
              </h2>
              {renderList(grouped.terminal, "没有历史任务")}
            </section>
          </>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {!urlTaskId && (
          <EmptyState
            title="选择一个任务"
            description="查看执行计划、进度，并启动或取消。"
          />
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
        {selected && !notFound && (
          <div className="max-w-2xl space-y-6">
            <header className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-medium text-fg-primary">{selected.title}</h2>
                  <p className="text-sm text-fg-tertiary mt-1">
                    {selected.work_type === "background" ? "后台任务" : "任务"}
                    {" · "}
                    <span className={statusClass(selected.status)}>
                      {statusLabel(selected.status)}
                    </span>
                    {handler?.dead_letter ? (
                      <span className="text-danger"> · 死信</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {canExecute && (
                    <Button
                      size="sm"
                      onClick={() => setConfirmExecute(true)}
                      disabled={busy}
                    >
                      执行
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
                        {done && <span className="ml-2 text-xs text-success">已完成</span>}
                        {current && <span className="ml-2 text-xs text-insight">当前</span>}
                      </li>
                    );
                  })}
                </ol>
              )}
              {steps.length > 0 && (
                <p className="text-xs text-fg-tertiary">
                  进度：{Math.min(resumeFrom, steps.length)} / {steps.length} 步
                  {typeof selected.progress === "number"
                    ? ` · work progress ${Math.round(
                        (selected.progress <= 1 ? selected.progress * 100 : selected.progress),
                      )}%`
                    : null}
                </p>
              )}
            </section>

            {outputEntries.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-fg-primary">执行日志</h3>
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
        )}
      </main>

      <Dialog
        open={confirmExecute && Boolean(selected && canExecute)}
        title="确认执行计划"
        description={formatPlanConfirmDescription(steps, resumeFrom)}
        confirmLabel="确认执行"
        cancelLabel="取消"
        onConfirm={() => {
          void handleExecute();
        }}
        onCancel={() => setConfirmExecute(false)}
      />
    </div>
  );
}
