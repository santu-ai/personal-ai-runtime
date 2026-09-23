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
  getInboxEmailDetail,
  getWorkDelivery,
  reworkWorkDelivery,
  rerunProjectBrief,
  scheduleBriefRepeat,
  updateWorkItemStatus,
  type InboxEmail,
  type WorkDelivery,
  type WorkDeliveryChangeAction,
  type WorkDeliveryChangeFinding,
  type WorkDeliveryChangeSource,
  type WorkDeliveryChanges,
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
import InboxEmailDetailModal from "../components/inbox/InboxEmailDetailModal";
import {
  deliverySourceRowId,
  emailMessageId,
  findDeliverySource,
  scrollToDeliverySource,
} from "../utils/deliverySourceNav";
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

function deliveryDecisionReason(
  delivery: WorkDelivery | null | undefined,
  status: "accepted" | "changes_requested",
): string {
  if (!delivery || delivery.review_status !== status) return "";
  const reason = delivery.latest_decision?.reason;
  return typeof reason === "string" ? reason.trim() : "";
}

function deliveryReworkReason(delivery: WorkDelivery | null | undefined): string {
  return deliveryDecisionReason(delivery, "changes_requested");
}

function deliveryAcceptReason(delivery: WorkDelivery | null | undefined): string {
  return deliveryDecisionReason(delivery, "accepted");
}

function checkResultLabel(result: string): string {
  if (result === "pass") return "通过";
  if (result === "fail") return "未通过";
  if (result === "needs_review") return "待判断";
  return result;
}

function checkResultClass(result: string): string {
  if (result === "pass") return "text-success";
  if (result === "fail") return "text-danger";
  if (result === "needs_review") return "text-warning";
  return "text-fg-secondary";
}

function checkDetailLabel(detail: string): string {
  const text = detail.trim();
  if (!text) return "";
  if (text === "0 missing citations") return "引用完整";
  if (text === "no sources in this run") return "本次没有来源";
  if (text === "limitations present") return "已写明不足";
  if (text === "sources available") return "已有来源";
  if (text === "all citations in allowed source set") return "引用都在允许的来源内";
  if (text === "requires human judgment") return "需要人工判断";
  const missing = /^(\d+) findings lack citations$/.exec(text);
  if (missing) return `${missing[1]} 条结论缺少来源`;
  return text;
}

function visibleDeliveryChecks(delivery: WorkDelivery | null | undefined): Array<{
  criterion: string;
  result: string;
  detail: string;
}> {
  const raw = delivery?.checks;
  if (!Array.isArray(raw)) return [];
  const rows: Array<{ criterion: string; result: string; detail: string }> = [];
  for (const check of raw) {
    if (!check || typeof check !== "object") continue;
    const criterion = typeof check.criterion === "string" ? check.criterion.trim() : "";
    const result = typeof check.result === "string" ? check.result.trim() : "";
    const detail = checkDetailLabel(typeof check.detail === "string" ? check.detail : "");
    if (!criterion && !result && !detail) continue;
    rows.push({ criterion, result, detail });
  }
  return rows;
}

function deliveryCheckSummary(delivery: WorkDelivery | null | undefined): string {
  const rows = visibleDeliveryChecks(delivery);
  if (rows.length === 0) return "";
  const names = new Map<string, string[]>();
  const seen: string[] = [];
  for (const row of rows) {
    if (!names.has(row.result)) {
      names.set(row.result, []);
      seen.push(row.result);
    }
    if (row.criterion) names.get(row.result)?.push(row.criterion);
  }
  const preferred = ["pass", "fail", "needs_review"];
  const keys = [
    ...preferred.filter((key) => names.has(key)),
    ...seen.filter((key) => key && !preferred.includes(key)),
  ];
  const parts = keys.map((key) => {
    const criteria = names.get(key) ?? [];
    const count = rows.filter((row) => row.result === key).length;
    const label = `${checkResultLabel(key)} ${count}`;
    if (key === "pass" || criteria.length === 0) return label;
    return `${label}（${criteria.join("、")}）`;
  });
  const unlabeled = rows.filter((row) => !row.result);
  if (unlabeled.length > 0) {
    const criteria = unlabeled.map((row) => row.criterion).filter(Boolean);
    parts.push(
      criteria.length > 0
        ? `未标明 ${unlabeled.length}（${criteria.join("、")}）`
        : `未标明 ${unlabeled.length}`,
    );
  }
  return parts.join(" · ");
}

function deliveryVersionLabel(row: WorkDelivery): string {
  const note = deliveryReworkReason(row) || deliveryAcceptReason(row);
  return [
    `v${row.version}`,
    reviewLabel(row.review_status),
    note.replace(/\s+/g, " "),
    deliveryCheckSummary(row),
    row.summary || "无摘要",
  ]
    .filter(Boolean)
    .join(" · ");
}

function DeliveryChecks({ delivery }: { delivery: WorkDelivery }) {
  const rows = visibleDeliveryChecks(delivery);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="delivery-checks">
      <h4 className="text-xs font-medium text-fg-tertiary">验收检查</h4>
      <ul className="text-sm space-y-1">
        {rows.map((row, index) => {
          const label = checkResultLabel(row.result);
          const rest = [row.criterion, row.detail].filter(Boolean).join(" · ");
          return (
            <li key={`${row.criterion}-${row.result}-${index}`} className="text-fg-secondary">
              {label ? <span className={checkResultClass(row.result)}>{label}</span> : null}
              {label && rest ? " · " : ""}
              {rest}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function findingKindLabel(kind: string | undefined): string {
  if (kind === "risk") return "风险";
  if (kind === "action") return "行动";
  if (!kind || kind === "change") return "变化";
  return kind;
}

function SourceIdChips({
  ids,
  onCite,
}: {
  ids: string[] | undefined;
  onCite: (sourceId: string) => void;
}) {
  const clean = (ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {clean.map((sourceId, index) => (
        <button
          key={`${sourceId}-${index}`}
          type="button"
          className="rounded-full border border-border-subtle bg-surface-overlay px-2 py-0.5 font-mono text-xs text-insight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          onClick={() => onCite(sourceId)}
          aria-label={`来源 ${sourceId}`}
        >
          {sourceId}
        </button>
      ))}
    </span>
  );
}

function DeliveryFindings({
  delivery,
  onCite,
}: {
  delivery: WorkDelivery;
  onCite: (sourceId: string) => void;
}) {
  const findings = delivery.findings ?? [];
  if (findings.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="delivery-findings">
      <h4 className="text-xs font-medium text-fg-tertiary">结论</h4>
      <ul className="text-sm text-fg-secondary space-y-1">
        {findings.map((item, index) => (
          <li key={`${item.text}-${index}`}>
            <span className="text-fg-tertiary">[{findingKindLabel(item.kind)}]</span> {item.text}
            <SourceIdChips ids={item.source_ids} onCite={onCite} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeliverySources({
  sources,
  activeSourceId,
  onOpenEmail,
}: {
  sources: WorkDelivery["sources"];
  activeSourceId: string | null;
  onOpenEmail: (sourceId: string) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-fg-tertiary mb-1">来源</h4>
      <ul className="text-sm text-fg-secondary space-y-1" data-testid="delivery-sources">
        {sources.map((src, index) => {
          const messageId = emailMessageId(src);
          const active = activeSourceId === src.id;
          const body = (
            <>
              <span className="font-mono text-xs text-fg-tertiary mr-2">{src.id}</span>
              {src.title}
              {src.locator ? ` · ${src.locator}` : ""}
            </>
          );
          return (
            <li
              key={`${src.id}-${index}`}
              id={deliverySourceRowId(src.id, index)}
              data-delivery-source-id={src.id}
              data-testid={`delivery-source-${src.id}`}
              className={active ? "rounded-md bg-insight/10 px-1 -mx-1" : undefined}
            >
              {messageId ? (
                <button
                  type="button"
                  className="text-left text-insight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                  aria-label={`打开邮件 ${src.title.trim() || src.id}`}
                  onClick={() => onOpenEmail(src.id)}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function joinedIds(ids: string[] | undefined): string {
  return (ids ?? []).filter((item) => item.trim()).join("、");
}

function findingLine(prefix: string, item: WorkDeliveryChangeFinding): string {
  const cites = joinedIds(item.source_ids);
  return `${prefix}：[${findingKindLabel(item.kind)}] ${item.text}${cites ? `（${cites}）` : ""}`;
}

function findingChangedLine(item: WorkDeliveryChangeFinding): string {
  const parts = [item.text];
  const previousKind = item.previous_kind || "change";
  const nextKind = item.kind || "change";
  if (previousKind !== nextKind) {
    parts.push(`${findingKindLabel(previousKind)} → ${findingKindLabel(nextKind)}`);
  }
  const previousIds = joinedIds(item.previous_source_ids);
  const nextIds = joinedIds(item.source_ids);
  if (previousIds !== nextIds) {
    parts.push(`来源 ${previousIds || "无"} → ${nextIds || "无"}`);
  }
  return `改写的结论：${parts.join("，")}`;
}

function sourceLabel(source: WorkDeliveryChangeSource): string {
  const title = source.title?.trim();
  return title ? `${source.id} ${title}` : source.id;
}

function sourceChangedLine(source: WorkDeliveryChangeSource): string {
  const parts = [source.id];
  const previousTitle = source.previous_title?.trim() || "";
  const title = source.title?.trim() || "";
  if (previousTitle !== title) {
    parts.push(`${previousTitle || "无标题"} → ${title || "无标题"}`);
  }
  const previousLocator = source.previous_locator?.trim() || "";
  const locator = source.locator?.trim() || "";
  if (previousLocator !== locator) {
    parts.push(`${previousLocator || "无定位"} → ${locator || "无定位"}`);
  }
  const previousType = source.previous_type?.trim() || "";
  const type = source.type?.trim() || "";
  if (previousType !== type) {
    parts.push(`${previousType || "无类型"} → ${type || "无类型"}`);
  }
  return `来源有更新：${parts.join("，")}`;
}

function actionChangedLine(action: WorkDeliveryChangeAction): string {
  const parts = [action.title];
  const previousReason = action.previous_reason?.trim() || "";
  const reason = action.reason?.trim() || "";
  if (previousReason !== reason) {
    parts.push(`理由 ${previousReason || "无"} → ${reason || "无"}`);
  }
  const previousIds = joinedIds(action.previous_source_ids);
  const nextIds = joinedIds(action.source_ids);
  if (previousIds !== nextIds) {
    parts.push(`来源 ${previousIds || "无"} → ${nextIds || "无"}`);
  }
  return `待办有更新：${parts.join("，")}`;
}

function deliveryChangeLines(delta: WorkDeliveryChanges): string[] {
  const lines = [
    ...(delta.findings_added ?? []).map((item) => findingLine("新增结论", item)),
    ...(delta.findings_removed ?? []).map((item) => findingLine("去掉的结论", item)),
    ...(delta.findings_changed ?? []).map((item) => findingChangedLine(item)),
    ...(delta.sources_added ?? []).map((item) => `新增来源：${sourceLabel(item)}`),
    ...(delta.sources_removed ?? []).map((item) => `去掉的来源：${sourceLabel(item)}`),
    ...(delta.sources_changed ?? []).map((item) => sourceChangedLine(item)),
    ...(delta.limitations_added ?? []).map((item) => `新增限制：${item}`),
    ...(delta.limitations_removed ?? []).map((item) => `去掉的限制：${item}`),
    ...(delta.actions_added ?? []).map((item) => `新增待办：${item.title}`),
    ...(delta.actions_removed ?? []).map((item) => `去掉的待办：${item.title}`),
    ...(delta.actions_changed ?? []).map((item) => actionChangedLine(item)),
  ];
  if (delta.summary_changed) lines.push("摘要已更新");
  const structuredBodyChanged =
    (delta.findings_added?.length ?? 0) +
      (delta.findings_removed?.length ?? 0) +
      (delta.findings_changed?.length ?? 0) +
      (delta.limitations_added?.length ?? 0) +
      (delta.limitations_removed?.length ?? 0) +
      (delta.actions_added?.length ?? 0) +
      (delta.actions_removed?.length ?? 0) +
      (delta.actions_changed?.length ?? 0) >
    0;
  if (delta.content_changed && !structuredBodyChanged) lines.push("正文已更新");
  return lines;
}

function DeliveryVersionDiff({ delivery }: { delivery: WorkDelivery }) {
  const delta = delivery.changes_from_previous;
  if (!delta) return null;
  const lines = deliveryChangeLines(delta);
  return (
    <div className="space-y-1" data-testid="delivery-version-diff">
      <h4 className="text-xs font-medium text-fg-tertiary">相对 v{delta.previous_version}</h4>
      {lines.length === 0 ? (
        <p className="text-sm text-fg-secondary">与上一版相同</p>
      ) : (
        <ul className="text-sm text-fg-secondary space-y-1">
          {lines.map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
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

function isRerunnableFailed(item: WorkItem): boolean {
  return item.status === "failed" && !isAdoptedSuggestion(item) && Boolean(item.executable_plan);
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

function formatAttributedCost(
  value: number | "unavailable",
  unattributedCalls: number | "unavailable" | undefined,
  unattributedCost?: number | "unavailable",
): string {
  if (value === "unavailable") return "模型成本未分开计";
  const cost = `模型成本 $${value.toFixed(4)}`;
  if (typeof unattributedCalls !== "number" || unattributedCalls <= 0) return cost;
  if (unattributedCost === "unavailable") return `${cost} · 未归因未分开计`;
  if (typeof unattributedCost === "number") {
    return `${cost} · 未归因 $${unattributedCost.toFixed(4)}（${unattributedCalls} 次）`;
  }
  return `${cost} · 未归因 ${unattributedCalls} 次`;
}

function DeliveryModelCost({ delivery }: { delivery: WorkDelivery }) {
  const cost = delivery.model_cost;
  if (!cost) return null;
  const money =
    cost.llm_cost === "unavailable" ? "模型成本未分开计" : `模型成本 $${cost.llm_cost.toFixed(4)}`;
  return (
    <p className="mt-1 text-xs text-fg-tertiary" data-testid="delivery-model-cost">
      {formatAttributedCount(cost.recovery_interventions, "恢复")}
      {" · "}
      {money}
    </p>
  );
}

function hasDeliveryMetrics(metrics: DeliveryMetrics | null): metrics is DeliveryMetrics {
  return Boolean(metrics && (metrics.reviewed_tasks > 0 || metrics.adopted_action_count > 0));
}

function RerunFailureReason({ reason }: { reason: string }) {
  const text = reason.trim();
  if (!text) return null;
  return (
    <p
      className="whitespace-pre-wrap break-all text-sm text-danger"
      data-testid="rerun-failure-reason"
    >
      {text}
    </p>
  );
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
  const [confirmRerun, setConfirmRerun] = useState(false);
  const [confirmSchedule, setConfirmSchedule] = useState(false);
  const [scheduleHours, setScheduleHours] = useState("");
  const [scheduleMinutes, setScheduleMinutes] = useState("");
  const [scheduledRepeatNote, setScheduledRepeatNote] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailQuery, setEmailQuery] = useState("");
  const [emailDays, setEmailDays] = useState("3");
  const [filePaths, setFilePaths] = useState("");
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkReason, setReworkReason] = useState("");
  const [acceptTarget, setAcceptTarget] = useState<WorkDelivery | null>(null);
  const [acceptNote, setAcceptNote] = useState("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyFull, setHistoryFull] = useState<WorkDelivery | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [inboxEmail, setInboxEmail] = useState<InboxEmail | null>(null);
  const citeRequest = useRef(0);
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
    setAcceptTarget(null);
    setAcceptNote("");
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
    setScheduledRepeatNote(null);
    setConfirmSchedule(false);
    setActiveSourceId(null);
    setInboxEmail(null);
    citeRequest.current += 1;
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
      if (ACTIVE_STATUSES.has(item.status) || isRerunnableFailed(item)) active.push(item);
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

  const handleRerun = async () => {
    if (!selected || executeInFlight.current) return;
    executeInFlight.current = true;
    setBusy(true);
    setConfirmRerun(false);
    try {
      await rerunProjectBrief(selected.id);
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "再次运行失败", "任务");
    } finally {
      executeInFlight.current = false;
      setBusy(false);
    }
  };

  const scheduleDelay = () => {
    const hours = Number(scheduleHours || 0);
    const minutes = Number(scheduleMinutes || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) {
      return null;
    }
    if (hours === 0 && minutes === 0) return null;
    return { hours, minutes };
  };

  const handleScheduleRepeat = async () => {
    if (!selected || executeInFlight.current) return;
    const delay = scheduleDelay();
    if (!delay) return;
    executeInFlight.current = true;
    setBusy(true);
    setConfirmSchedule(false);
    try {
      const scheduled = await scheduleBriefRepeat(selected.id, delay);
      setScheduledRepeatNote(
        scheduled.fire_at
          ? `已设定，将在 ${scheduled.fire_at} 再次运行这一份任务。`
          : "已设定，到点后再次运行这一份任务。",
      );
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "设定定时失败", "任务");
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

  const handleAccept = async () => {
    if (!selected || !acceptTarget) return;
    const note = acceptNote.trim();
    setBusy(true);
    if (!acceptKey.current) acceptKey.current = newIdempotencyKey("accept");
    try {
      await acceptWorkDelivery(selected.id, acceptTarget.delivery_id, {
        ...(note ? { reason: note } : {}),
        idempotency_key: acceptKey.current,
      });
      setAcceptTarget(null);
      setAcceptNote("");
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

  const openCitedSource = async (sourceId: string, sources: WorkDelivery["sources"]) => {
    const matched = findDeliverySource(sources, sourceId);
    const targetId = matched?.id ?? sourceId.trim();
    setActiveSourceId(targetId || null);
    scrollToDeliverySource(targetId);
    const messageId = matched ? emailMessageId(matched) : null;
    if (!messageId) return;
    const requestId = ++citeRequest.current;
    try {
      const detail = await getInboxEmailDetail(messageId);
      if (citeRequest.current !== requestId) return;
      setInboxEmail(detail);
    } catch (err) {
      if (citeRequest.current !== requestId) return;
      addError(err instanceof ApiError ? err.message : "加载邮件详情失败", "任务");
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
                  <span className="min-w-0 truncate text-sm text-fg-primary">{item.title}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {isRerunnableFailed(item) ? (
                      <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-xs text-danger">
                        可重新执行
                      </span>
                    ) : null}
                    <span className={`text-xs ${statusClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
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
  const rerun =
    selected?.status === "failed" || (executionFailed && selected?.status === "running");
  const failureReason = rerun ? (handler?.error ?? "") : "";
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
  const canRerunSameBrief = Boolean(
    selected && isProjectBrief(selected) && selected.status === "completed" && currentDelivery,
  );
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
              {formatAttributedCost(
                metrics.attribution.llm_cost,
                metrics.attribution.unattributed_project_brief_calls,
                metrics.attribution.unattributed_project_brief_cost,
              )}
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
                  <section aria-label="进行中">
                    <p className="section-label mb-2 px-1">进行中</p>
                    {renderList(grouped.active, "没有进行中的任务")}
                  </section>
                  <section aria-label="历史">
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
                            {rerun ? "重新执行" : "执行"}
                          </Button>
                        )}
                        {canRerunSameBrief && (
                          <Button size="sm" onClick={() => setConfirmRerun(true)} disabled={busy}>
                            再次运行
                          </Button>
                        )}
                        {canRerunSameBrief && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setConfirmSchedule(true)}
                            disabled={busy}
                          >
                            定时再次运行
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
                    {canRerunSameBrief ? (
                      <p className="text-xs text-fg-tertiary" data-testid="rerun-same-brief-hint">
                        再次运行仍使用这一份任务。新版本会对照当前交付，显示相对上一版的变化。定时到点后也只再次运行这一份，不另建简报。
                      </p>
                    ) : null}
                    {scheduledRepeatNote ? (
                      <p className="text-xs text-fg-secondary" data-testid="scheduled-repeat-note">
                        {scheduledRepeatNote}
                      </p>
                    ) : null}
                  </header>

                  {viewingHistory && historyLoading && (
                    <p className="text-sm text-fg-tertiary">加载历史版本全文…</p>
                  )}
                  {viewingHistory && historyError && (
                    <p className="text-sm text-danger">{historyError}</p>
                  )}
                  {shownDelivery && failureReason ? (
                    <RerunFailureReason reason={failureReason} />
                  ) : null}
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
                          <DeliveryModelCost delivery={shownDelivery} />
                          {deliveryReworkReason(shownDelivery) ? (
                            <p
                              className="text-sm text-fg-secondary mt-1 whitespace-pre-wrap break-words"
                              data-testid="rework-reason"
                            >
                              <span className="text-fg-tertiary">返工理由：</span>
                              {deliveryReworkReason(shownDelivery)}
                            </p>
                          ) : null}
                          {deliveryAcceptReason(shownDelivery) ? (
                            <p
                              className="text-sm text-fg-secondary mt-1 whitespace-pre-wrap break-words"
                              data-testid="accept-reason"
                            >
                              <span className="text-fg-tertiary">验收说明：</span>
                              {deliveryAcceptReason(shownDelivery)}
                            </p>
                          ) : null}
                        </div>
                        {!viewingHistory && shownDelivery.review_status === "unreviewed" && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => setAcceptTarget(shownDelivery)}
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
                      <DeliveryChecks delivery={shownDelivery} />
                      <DeliveryVersionDiff delivery={shownDelivery} />
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
                      <DeliveryFindings
                        delivery={shownDelivery}
                        onCite={(sourceId) => void openCitedSource(sourceId, shownDelivery.sources)}
                      />
                      <DeliverySources
                        sources={shownDelivery.sources}
                        activeSourceId={activeSourceId}
                        onOpenEmail={(sourceId) =>
                          void openCitedSource(sourceId, shownDelivery.sources)
                        }
                      />
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
                                  <SourceIdChips
                                    ids={action.source_ids}
                                    onCite={(sourceId) =>
                                      void openCitedSource(sourceId, shownDelivery.sources)
                                    }
                                  />
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
                    <div className="space-y-2">
                      <p className="text-sm text-fg-tertiary">
                        {selected.status === "failed" || executionFailed
                          ? "执行失败，尚未发布合格交付。可查看执行日志后重试。"
                          : "还没有交付结果。确认资料范围后执行任务。"}
                      </p>
                      <RerunFailureReason reason={failureReason} />
                    </div>
                  ) : selected.status === "failed" && canExecute ? (
                    <div className="space-y-2">
                      <p className="text-sm text-danger">上次执行已失败。可以重新执行。</p>
                      <RerunFailureReason reason={failureReason} />
                    </div>
                  ) : executionFailed && selected.status === "running" ? (
                    <div className="space-y-2">
                      <p className="text-sm text-danger">
                        上次执行已失败，任务仍显示为进行中。可以重新执行。
                      </p>
                      <RerunFailureReason reason={failureReason} />
                    </div>
                  ) : (
                    <RerunFailureReason reason={failureReason} />
                  )}

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
                              {deliveryVersionLabel(row)}
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
                        <section className="space-y-1 text-sm" aria-label="执行状态">
                          <h3 className="text-sm font-medium text-fg-primary">执行状态</h3>
                          <p className="text-fg-secondary">
                            handler: {handler.handler_name || "—"} · {handler.status}
                            {handler.dead_letter ? " · dead_letter" : ""}
                            {handler.retry_count > 0 ? ` · 重试 ${handler.retry_count}` : ""}
                          </p>
                          {handler.error ? (
                            <p className="whitespace-pre-wrap break-all text-xs text-danger">
                              {handler.error}
                            </p>
                          ) : null}
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
          open={confirmRerun && canRerunSameBrief}
          title="再次运行同一份简报"
          description="将重新执行这份简报，不另建任务，也不记成返工。完成后的新版本会对照当前这一版，显示相对上一版的变化。"
          confirmLabel="确认再次运行"
          cancelLabel="取消"
          confirmDisabled={busy}
          onConfirm={() => {
            void handleRerun();
          }}
          onCancel={() => setConfirmRerun(false)}
        />

        <Dialog
          open={confirmSchedule && canRerunSameBrief}
          title="定时再次运行这一份简报"
          description="到点后只再次运行这一份任务。不会新开一份简报，也不会为这次触发另建交付。若到点时它已经不能再次运行，提醒只会打开这一份任务。"
          confirmLabel="确认定时"
          cancelLabel="取消"
          confirmDisabled={busy || scheduleDelay() === null}
          onConfirm={() => {
            void handleScheduleRepeat();
          }}
          onCancel={() => setConfirmSchedule(false)}
        >
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">小时</span>
              <Input
                inputMode="decimal"
                value={scheduleHours}
                onChange={(e) => setScheduleHours(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">分钟</span>
              <Input
                inputMode="decimal"
                value={scheduleMinutes}
                onChange={(e) => setScheduleMinutes(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
        </Dialog>

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
          open={Boolean(acceptTarget)}
          title="验收交付"
          description="可以留下验收说明。留空则直接验收，说明不会显示。"
          confirmLabel="确认验收"
          cancelLabel="取消"
          confirmDisabled={busy}
          onConfirm={() => {
            void handleAccept();
          }}
          onCancel={() => setAcceptTarget(null)}
        >
          <textarea
            className="w-full min-h-24 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
            value={acceptNote}
            onChange={(e) => setAcceptNote(e.target.value)}
            placeholder="例如：结论和来源都齐了。"
          />
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
        <InboxEmailDetailModal email={inboxEmail} onClose={() => setInboxEmail(null)} />
      </div>
    </div>
  );
}
