import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import LoadErrorNotice, {
  queryErrorMessage,
  useHeldQueryError,
} from "../components/ui/LoadErrorNotice";
import PageHeader from "../components/ui/PageHeader";
import Spinner from "../components/ui/Spinner";
import InboxEmailDetailModal from "../components/inbox/InboxEmailDetailModal";
import {
  citationLookupSources,
  deliverySourceRowId,
  emailMessageId,
  findDeliverySource,
  scrollToDeliverySource,
  splitBacktickSourceIds,
  type DeliverySourceRef,
} from "../utils/deliverySourceNav";
import { timeAgo } from "../utils/timeUtils";
import { toolLabel } from "../utils/toolLabels";
import { ListTodo } from "lucide-react";

const ACTIVE_STATUSES = new Set(["pending", "running", "blocked", "waiting_approval"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const OUTPUT_PREVIEW = 240;
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app";
const backLinkClass = `inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${focusRing}`;
const backLinkSecondary = `${backLinkClass} border border-border-subtle bg-surface-raised text-fg-primary hover:bg-surface-hover`;
const backLinkPrimary = `${backLinkClass} bg-insight-strong text-fg-on-accent shadow-sm hover:bg-insight`;
const adoptedLinkClass = `inline-flex shrink-0 items-center justify-center rounded-md bg-transparent px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-hover ${focusRing}`;

function taskPageHref(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}`;
}

/** 已转任务的 id 去掉空白后仍非空才打开任务页。 */
function adoptedTaskHref(workId: string | null | undefined): string | undefined {
  const id = workId?.trim();
  if (!id) return undefined;
  return taskPageHref(id);
}

type TaskDirectHandoff = {
  taskId: string;
  kind: "complete" | "cancel" | "adopt";
  index?: number;
};

/** 焦点在页面空白处，或还停在已经卸掉的按钮上，才安放。已经在别的控件上就不再抢。 */
function focusIsIdle(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

function isShown(node: HTMLElement): boolean {
  let current: HTMLElement | null = node;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return node.isConnected;
}

function focusShown(selector: string): boolean {
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    if (!isShown(node)) continue;
    node.focus();
    if (document.activeElement === node) return true;
  }
  return false;
}

function placeDirectActionFocus(handoff: TaskDirectHandoff): void {
  if (handoff.kind === "adopt" && handoff.index !== undefined) {
    if (focusShown(`[data-task-adopted="${handoff.index}"]`)) return;
  }
  if (focusShown("[data-task-current]")) return;
  focusShown("[data-task-back]");
}

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
    deliveryModelCostLabel(row.model_cost),
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

/** 正在读的来源 id。同一封还在读时，这一来源上的按钮标为忙碌，但不禁用。 */
const OpeningMailSourceContext = createContext<string | null>(null);

function SourceIdChips({
  ids,
  onCite,
  inline = false,
  linkable,
}: {
  ids: string[] | undefined;
  onCite: (sourceId: string) => void;
  /** Sit inside a sentence. Separate ids with `、` and drop the leading margin. */
  inline?: boolean;
  /** Ids that return false stay plain text. Omitted means every id is a button. */
  linkable?: (sourceId: string) => boolean;
}) {
  const openingId = useContext(OpeningMailSourceContext);
  const clean = (ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  return (
    <span
      className={
        inline
          ? "inline-flex flex-wrap items-center align-middle"
          : "ml-2 inline-flex flex-wrap gap-1 align-middle"
      }
    >
      {clean.map((sourceId, index) => {
        const busy = openingId === sourceId;
        return (
          <span key={`${sourceId}-${index}`}>
            {inline && index > 0 ? "、" : null}
            {linkable && !linkable(sourceId) ? (
              sourceId
            ) : (
              <button
                type="button"
                className={`rounded-full border border-border-subtle bg-surface-overlay px-2 py-0.5 font-mono text-xs text-insight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${busy ? " opacity-50" : ""}`}
                onClick={() => onCite(sourceId)}
                aria-label={`来源 ${sourceId}`}
                aria-busy={busy || undefined}
              >
                {sourceId}
              </button>
            )}
          </span>
        );
      })}
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
  const openingId = useContext(OpeningMailSourceContext);
  if (sources.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-fg-tertiary mb-1">来源</h4>
      <ul className="text-sm text-fg-secondary space-y-1" data-testid="delivery-sources">
        {sources.map((src, index) => {
          const messageId = emailMessageId(src);
          const active = activeSourceId === src.id;
          const busy = openingId === src.id;
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
                  className={`text-left text-insight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded${busy ? " opacity-50" : ""}`}
                  aria-label={`打开邮件 ${src.title.trim() || src.id}`}
                  aria-busy={busy || undefined}
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

function findingRemovedLine(
  item: WorkDeliveryChangeFinding,
  onCite: (sourceId: string) => void,
  canCite: (sourceId: string) => boolean,
): ReactNode {
  return (
    <>
      {`去掉的结论：[${findingKindLabel(item.kind)}] ${item.text}`}
      {joinedIds(item.source_ids) ? (
        <>
          （<SourceIdChips ids={item.source_ids} onCite={onCite} inline linkable={canCite} />）
        </>
      ) : null}
    </>
  );
}

function currentVersionSourceIds(
  ids: string[] | undefined,
  onCite: (sourceId: string) => void,
): ReactNode {
  if (!joinedIds(ids)) return "无";
  return <SourceIdChips ids={ids} onCite={onCite} inline />;
}

function findingAddedLine(
  item: WorkDeliveryChangeFinding,
  onCite: (sourceId: string) => void,
): ReactNode {
  return (
    <>
      {`新增结论：[${findingKindLabel(item.kind)}] ${item.text}`}
      {joinedIds(item.source_ids) ? (
        <>（{currentVersionSourceIds(item.source_ids, onCite)}）</>
      ) : null}
    </>
  );
}

function findingChangedLine(
  item: WorkDeliveryChangeFinding,
  onCite: (sourceId: string) => void,
  canCite: (sourceId: string) => boolean,
): ReactNode {
  const previousKind = item.previous_kind || "change";
  const nextKind = item.kind || "change";
  const kindChange =
    previousKind !== nextKind
      ? `，${findingKindLabel(previousKind)} → ${findingKindLabel(nextKind)}`
      : "";
  const previousIds = joinedIds(item.previous_source_ids);
  const nextIds = joinedIds(item.source_ids);
  return (
    <>
      {`改写的结论：${item.text}${kindChange}`}
      {previousIds !== nextIds ? (
        <>
          ，来源{" "}
          {previousIds ? (
            <SourceIdChips
              ids={item.previous_source_ids}
              onCite={onCite}
              inline
              linkable={canCite}
            />
          ) : (
            "无"
          )}{" "}
          → {currentVersionSourceIds(item.source_ids, onCite)}
        </>
      ) : null}
    </>
  );
}

function sourceLabel(source: WorkDeliveryChangeSource): string {
  const title = source.title?.trim();
  return title ? `${source.id} ${title}` : source.id;
}

function sourceRemovedLine(
  source: WorkDeliveryChangeSource,
  onCite: (sourceId: string) => void,
  canCite: (sourceId: string) => boolean,
): ReactNode {
  const id = source.id.trim();
  const title = source.title?.trim() ?? "";
  return (
    <>
      {"去掉的来源："}
      {id && canCite(id) ? <SourceIdChips ids={[id]} onCite={onCite} inline /> : id}
      {title ? ` ${title}` : ""}
    </>
  );
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

function actionAddedLine(
  action: WorkDeliveryChangeAction,
  onCite: (sourceId: string) => void,
): ReactNode {
  return (
    <>
      {`新增待办：${action.title}`}
      {joinedIds(action.source_ids) ? (
        <>（{currentVersionSourceIds(action.source_ids, onCite)}）</>
      ) : null}
    </>
  );
}

function actionRemovedLine(
  action: WorkDeliveryChangeAction,
  onCite: (sourceId: string) => void,
  canCite: (sourceId: string) => boolean,
): ReactNode {
  return (
    <>
      {`去掉的待办：${action.title}`}
      {joinedIds(action.source_ids) ? (
        <>
          （<SourceIdChips ids={action.source_ids} onCite={onCite} inline linkable={canCite} />）
        </>
      ) : null}
    </>
  );
}

function actionChangedLine(
  action: WorkDeliveryChangeAction,
  onCite: (sourceId: string) => void,
  canCite: (sourceId: string) => boolean,
): ReactNode {
  const previousReason = action.previous_reason?.trim() || "";
  const reason = action.reason?.trim() || "";
  const reasonChange =
    previousReason !== reason ? `，理由 ${previousReason || "无"} → ${reason || "无"}` : "";
  const previousIds = joinedIds(action.previous_source_ids);
  const nextIds = joinedIds(action.source_ids);
  return (
    <>
      {`待办有更新：${action.title}${reasonChange}`}
      {previousIds !== nextIds ? (
        <>
          ，来源{" "}
          {previousIds ? (
            <SourceIdChips
              ids={action.previous_source_ids}
              onCite={onCite}
              inline
              linkable={canCite}
            />
          ) : (
            "无"
          )}{" "}
          → {currentVersionSourceIds(action.source_ids, onCite)}
        </>
      ) : null}
    </>
  );
}

function deliveryChangeLines(
  delta: WorkDeliveryChanges,
  onCite: (sourceId: string) => void,
  canCite: (sourceId: string) => boolean,
): ReactNode[] {
  const lines: ReactNode[] = [
    ...(delta.findings_added ?? []).map((item) => findingAddedLine(item, onCite)),
    ...(delta.findings_removed ?? []).map((item) => findingRemovedLine(item, onCite, canCite)),
    ...(delta.findings_changed ?? []).map((item) => findingChangedLine(item, onCite, canCite)),
    ...(delta.sources_added ?? []).map((item) => `新增来源：${sourceLabel(item)}`),
    ...(delta.sources_removed ?? []).map((item) => sourceRemovedLine(item, onCite, canCite)),
    ...(delta.sources_changed ?? []).map((item) => sourceChangedLine(item)),
    ...(delta.limitations_added ?? []).map((item) => `新增限制：${item}`),
    ...(delta.limitations_removed ?? []).map((item) => `去掉的限制：${item}`),
    ...(delta.actions_added ?? []).map((item) => actionAddedLine(item, onCite)),
    ...(delta.actions_removed ?? []).map((item) => actionRemovedLine(item, onCite, canCite)),
    ...(delta.actions_changed ?? []).map((item) => actionChangedLine(item, onCite, canCite)),
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

function comparedSourceCandidates(
  delivery: WorkDelivery,
  versions: readonly WorkDelivery[] | undefined,
): DeliverySourceRef[] {
  const delta = delivery.changes_from_previous;
  if (!delta) return [];
  const previousId = delta.previous_delivery_id?.trim();
  const previous = previousId
    ? (versions?.find((row) => row.delivery_id === previousId)?.sources ?? [])
    : [];
  const removed = (delta.sources_removed ?? []).map((source) => ({
    id: source.id,
    type: source.type ?? "",
  }));
  return [...previous, ...removed];
}

function DeliveryBodyText({
  content,
  sources,
  onCite,
}: {
  content: string;
  sources: WorkDelivery["sources"];
  onCite: (sourceId: string) => void;
}) {
  const spans = splitBacktickSourceIds(content, sources);
  if (spans.every((span) => span.kind === "text")) return content;
  return (
    <>
      {spans.map((span, index) =>
        span.kind === "source" ? (
          <SourceIdChips key={`${span.text}-${index}`} ids={[span.text]} onCite={onCite} inline />
        ) : (
          <span key={`text-${index}`}>{span.text}</span>
        ),
      )}
    </>
  );
}

function DeliveryVersionDiff({
  delivery,
  onCite,
  canCite,
}: {
  delivery: WorkDelivery;
  onCite: (sourceId: string) => void;
  canCite: (sourceId: string) => boolean;
}) {
  const delta = delivery.changes_from_previous;
  if (!delta) return null;
  const lines = deliveryChangeLines(delta, onCite, canCite);
  return (
    <div
      className="space-y-1 break-words rounded-lg bg-surface-sunken px-3 py-2"
      data-testid="delivery-version-diff"
    >
      <h4 className="text-xs font-medium text-fg-tertiary">相对 v{delta.previous_version}</h4>
      {lines.length === 0 ? (
        <p className="text-sm text-fg-secondary">与上一版相同</p>
      ) : (
        <ul className="space-y-1 text-sm text-fg-secondary">
          {lines.map((line, index) => (
            <li key={index} className="break-words">
              {line}
            </li>
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

function deliveryModelCostLabel(cost: WorkDelivery["model_cost"]): string {
  if (!cost) return "";
  const money =
    cost.llm_cost === "unavailable" ? "模型成本未分开计" : `模型成本 $${cost.llm_cost.toFixed(4)}`;
  return `${formatAttributedCount(cost.recovery_interventions, "恢复")} · ${money}`;
}

function formatAttributedCost(
  value: number | "unavailable",
  unattributedCalls: number | "unavailable" | undefined,
  unattributedCost?: number | "unavailable",
): string {
  // Window total. A delivery's own line stays「模型成本」and is not this sum.
  if (value === "unavailable") return "窗口模型成本未分开计";
  const cost = `窗口模型成本 $${value.toFixed(4)}`;
  if (typeof unattributedCalls !== "number" || unattributedCalls <= 0) return cost;
  if (unattributedCost === "unavailable") return `${cost} · 未归因未分开计`;
  if (typeof unattributedCost === "number") {
    return `${cost} · 未归因 $${unattributedCost.toFixed(4)}（${unattributedCalls} 次）`;
  }
  return `${cost} · 未归因 ${unattributedCalls} 次`;
}

function DeliveryModelCost({ delivery }: { delivery: WorkDelivery }) {
  const label = deliveryModelCostLabel(delivery.model_cost);
  if (!label) return null;
  return (
    <p className="mt-1 text-xs text-fg-tertiary" data-testid="delivery-model-cost">
      {label}
    </p>
  );
}

function hasDeliveryMetrics(metrics: DeliveryMetrics | null): metrics is DeliveryMetrics {
  return Boolean(metrics && (metrics.reviewed_tasks > 0 || metrics.adopted_action_count > 0));
}

function deliveryBodyText(content: string | undefined): string {
  if (content?.trim()) return content;
  return "这一版没有正文";
}

function versionRowButton(list: HTMLElement, deliveryId: string): HTMLButtonElement | null {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(deliveryId)
      : deliveryId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return list.querySelector<HTMLButtonElement>(`button[data-delivery-id="${escaped}"]`);
}

function nextVersionIndex(index: number, count: number, key: string): number | null {
  if (index < 0 || count === 0) return null;
  if (key === "ArrowDown") return Math.min(count - 1, index + 1);
  if (key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function DeliveryVersionHistory({
  rows,
  openDeliveryId,
  historyLoading,
  onOpen,
}: {
  rows: readonly WorkDelivery[];
  openDeliveryId: string | null | undefined;
  historyLoading: boolean;
  onOpen: (deliveryId: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const tabTarget =
    tabId && rows.some((row) => row.delivery_id === tabId)
      ? tabId
      : (openDeliveryId ?? rows[0]?.delivery_id);

  const focusRow = (deliveryId: string) => {
    setTabId(deliveryId);
    const list = listRef.current;
    if (!list) return;
    versionRowButton(list, deliveryId)?.focus();
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-fg-primary">版本历史</h3>
      <ul ref={listRef} className="space-y-1">
        {rows.map((row) => {
          const open = row.delivery_id === openDeliveryId;
          return (
            <li key={row.delivery_id}>
              <button
                type="button"
                data-delivery-id={row.delivery_id}
                tabIndex={row.delivery_id === tabTarget ? 0 : -1}
                aria-current={open ? "true" : undefined}
                aria-busy={open && historyLoading ? true : undefined}
                className={`break-words rounded-sm text-left text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  open ? "bg-insight/10 px-1 text-fg-primary" : "text-insight"
                }`}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                  const next = nextVersionIndex(
                    rows.findIndex((item) => item.delivery_id === row.delivery_id),
                    rows.length,
                    event.key,
                  );
                  if (next == null) return;
                  event.preventDefault();
                  const target = rows[next];
                  if (!target || target.delivery_id === row.delivery_id) return;
                  focusRow(target.delivery_id);
                }}
                onClick={() => {
                  setTabId(row.delivery_id);
                  onOpen(row.delivery_id);
                }}
              >
                {deliveryVersionLabel(row)}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DeliveryMetricsWorks({ items }: { items: DeliveryMetrics["items"] | undefined }) {
  const rows = items ?? [];
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1 pt-1" data-testid="delivery-metrics-works">
      {rows.map((item, index) => {
        const workId = item.work_id.trim();
        const title = item.title.trim() || "项目简报";
        if (!workId) {
          return (
            <li key={`blank-${index}`} className="text-xs text-fg-secondary">
              {title}
            </li>
          );
        }
        return (
          <li key={`${workId}-${index}`} className="text-xs">
            <Link
              to={`/tasks/${encodeURIComponent(workId)}`}
              className="text-fg-primary hover:underline"
            >
              {title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type TaskDialogName = "create" | "accept" | "rework" | "schedule" | "execute" | "rerun";
type TaskDraftDialog = "create" | "accept" | "rework" | "schedule";
type TaskDialogHandoff =
  { kind: "failed"; dialog: TaskDialogName } | { kind: "kept"; dialog: TaskDraftDialog };

interface BriefDraft {
  title: string;
  objective: string;
  emailEnabled: boolean;
  emailQuery: string;
  emailDays: string;
  filePaths: string;
}

function sameBrief(left: BriefDraft, right: BriefDraft): boolean {
  return (
    left.title === right.title &&
    left.objective === right.objective &&
    left.emailEnabled === right.emailEnabled &&
    left.emailQuery === right.emailQuery &&
    left.emailDays === right.emailDays &&
    left.filePaths === right.filePaths
  );
}

function focusIsBlank(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("role") === "dialog";
}

function focusOnTaskDialog(name: TaskDialogName): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return (
    active.getAttribute("data-dialog-confirm") === name ||
    active.getAttribute("data-task-dialog-field") === name
  );
}

function focusTaskDialogField(name: TaskDraftDialog): boolean {
  const field = document.querySelector<HTMLElement>(`[data-task-dialog-field="${name}"]`);
  if (!field) return false;
  if (
    (field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement) &&
    field.disabled
  ) {
    return false;
  }
  if (document.activeElement !== field) field.focus();
  return document.activeElement === field;
}

function focusTaskDialogConfirm(name: TaskDialogName): boolean {
  const button = document.querySelector<HTMLButtonElement>(`[data-dialog-confirm="${name}"]`);
  if (!button || button.disabled) return false;
  if (document.activeElement !== button) button.focus();
  return document.activeElement === button;
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
  const {
    data: items = [],
    error: listError,
    isLoading,
    isFetching: listFetching,
    refetch: refetchTasks,
  } = useTasksQuery();
  const {
    data: selected,
    error: detailError,
    isError: detailIsError,
    isFetching: detailFetching,
    refetch: refetchTask,
  } = useTaskDetailQuery(urlTaskId);
  const invalidate = useInvalidateTasks();
  const addError = useErrorStore((s) => s.addError);
  const [busy, setBusy] = useState(false);
  const dialogLock = useRef(false);
  const actionLock = useRef(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const focusAfter = useRef<TaskDirectHandoff | null>(null);
  const taskIdRef = useRef(urlTaskId);
  taskIdRef.current = urlTaskId;
  const [dialogBusy, setDialogBusy] = useState(false);
  const dialogHandoff = useRef<TaskDialogHandoff | null>(null);
  const briefLive = useRef<BriefDraft>({
    title: "",
    objective: "",
    emailEnabled: true,
    emailQuery: "",
    emailDays: "3",
    filePaths: "",
  });
  const acceptLive = useRef("");
  const reworkLive = useRef("");
  const scheduleLive = useRef({ hours: "", minutes: "" });
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
  const [historyRetry, setHistoryRetry] = useState(0);
  const historyRequestKey = useRef<string | null>(null);
  const historyErrorRef = useRef<HTMLDivElement>(null);
  const deliveryTitleRef = useRef<HTMLHeadingElement>(null);
  const deliverySlotRef = useRef<HTMLDivElement>(null);
  const deliveryScrollRef = useRef<{
    taskId: string | undefined;
    historyId: string | null;
    loading: boolean;
    suppressNull: boolean;
  } | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [inboxEmail, setInboxEmail] = useState<InboxEmail | null>(null);
  const [citeSourceId, setCiteSourceId] = useState<string | null>(null);
  const [citeMessageId, setCiteMessageId] = useState<string | null>(null);
  const [citeError, setCiteError] = useState<unknown>(null);
  const [citeLoadingId, setCiteLoadingId] = useState<string | null>(null);
  const citeRequest = useRef(0);
  const citeInflight = useRef<string | null>(null);
  const citeBusy = Boolean(citeMessageId && citeLoadingId === citeMessageId);
  // 重试会把这次错误清掉。原因留在交付区，避免来源按钮改成「加载中...」。
  const shownCiteError = useHeldQueryError(
    false,
    citeError,
    citeBusy,
    "加载邮件详情失败",
    citeMessageId ?? "",
  );
  const [metrics, setMetrics] = useState<DeliveryMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsRefresh, setMetricsRefresh] = useState(0);
  const acceptKey = useRef<string | null>(null);
  const adoptKeys = useRef<Record<number, string>>({});

  const notFound =
    Boolean(urlTaskId) &&
    detailIsError &&
    detailError instanceof ApiError &&
    detailError.status === 404;
  const shownListError = useHeldQueryError(
    items.length > 0,
    listError,
    listFetching,
    "加载任务失败",
    "list",
  );
  const shownDetailError = useHeldQueryError(
    Boolean(selected) || notFound || !urlTaskId,
    notFound ? null : detailError,
    detailFetching,
    "加载任务详情失败",
    urlTaskId ?? "",
  );

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
    setHistoryRetry(0);
    acceptKey.current = null;
    adoptKeys.current = {};
    actionLock.current = false;
    focusAfter.current = null;
    setActionBusy(null);
  }, [urlTaskId]);

  useEffect(() => {
    if (!urlTaskId || !historyId) {
      historyRequestKey.current = null;
      setHistoryFull(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    const requestKey = `${urlTaskId}:${historyId}`;
    const sameTarget = historyRequestKey.current === requestKey;
    historyRequestKey.current = requestKey;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryFull(null);
    if (!sameTarget) setHistoryError(null);
    void getWorkDelivery(urlTaskId, historyId)
      .then((row) => {
        if (!cancelled) {
          setHistoryFull(row);
          setHistoryError(null);
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
  }, [urlTaskId, historyId, historyRetry]);

  useEffect(() => {
    if (!historyError || historyLoading) return;
    const root = historyErrorRef.current;
    const button = root?.querySelector("button");
    if (!root || !button || root.contains(document.activeElement)) return;
    button.focus();
  }, [historyError, historyLoading]);

  useEffect(() => {
    setScheduledRepeatNote(null);
    setConfirmSchedule(false);
    setActiveSourceId(null);
    setInboxEmail(null);
    setCiteSourceId(null);
    setCiteMessageId(null);
    setCiteError(null);
    setCiteLoadingId(null);
    citeRequest.current += 1;
    citeInflight.current = null;
  }, [urlTaskId, historyId]);

  useEffect(() => {
    if (listError) {
      addError(queryErrorMessage(listError, "加载任务失败"), "任务");
    }
  }, [listError, addError]);

  useEffect(() => {
    if (detailError && !(detailError instanceof ApiError && detailError.status === 404)) {
      addError(queryErrorMessage(detailError, "加载任务详情失败"), "任务");
    }
  }, [detailError, addError]);

  useEffect(() => {
    let cancelled = false;
    setMetricsLoading(true);
    void getDeliveryMetrics(30)
      .then((value) => {
        if (cancelled) return;
        setMetrics(value);
        setMetricsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const text = queryErrorMessage(err, "加载简报指标失败");
        setMetricsError(text);
        addError(text, "任务");
      })
      .finally(() => {
        if (!cancelled) setMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metricsRefresh, addError]);

  const grouped = useMemo(() => {
    const active: WorkItem[] = [];
    const terminal: WorkItem[] = [];
    for (const item of items) {
      if (ACTIVE_STATUSES.has(item.status) || isRerunnableFailed(item)) active.push(item);
      else terminal.push(item);
    }
    return { active, terminal };
  }, [items]);

  const beginDialog = () => {
    if (dialogLock.current || actionLock.current) return false;
    dialogHandoff.current = null;
    dialogLock.current = true;
    setDialogBusy(true);
    setBusy(true);
    return true;
  };

  const beginDirect = (taskId: string, token: string): boolean => {
    if (!taskId || actionLock.current || dialogLock.current) return false;
    focusAfter.current = null;
    actionLock.current = true;
    setActionBusy(token);
    return true;
  };

  const endDirect = (taskId: string, handoff: TaskDirectHandoff | null) => {
    if (taskIdRef.current !== taskId) return;
    if (handoff) focusAfter.current = handoff;
    actionLock.current = false;
    setActionBusy(null);
  };

  const openActionDialog = (open: () => void) => {
    // 这次写还没回来时，后面的按钮不禁用，但也不另开对话框。
    if (actionLock.current || dialogLock.current) return;
    open();
  };

  const endDialog = () => {
    dialogLock.current = false;
    setDialogBusy(false);
    setBusy(false);
  };

  useEffect(() => {
    if (dialogBusy) return;
    const pending = dialogHandoff.current;
    if (!pending) return;
    if (pending.kind === "kept") {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.getAttribute("data-task-dialog-field") === pending.dialog
      ) {
        dialogHandoff.current = null;
        return;
      }
      if (focusOnTaskDialog(pending.dialog) || focusIsBlank()) {
        if (focusTaskDialogField(pending.dialog)) dialogHandoff.current = null;
        return;
      }
      dialogHandoff.current = null;
      return;
    }
    if (focusOnTaskDialog(pending.dialog)) {
      dialogHandoff.current = null;
      return;
    }
    if (!focusIsBlank()) {
      dialogHandoff.current = null;
      return;
    }
    if (focusTaskDialogConfirm(pending.dialog)) {
      dialogHandoff.current = null;
      return;
    }
    if (
      pending.dialog === "create" ||
      pending.dialog === "accept" ||
      pending.dialog === "rework" ||
      pending.dialog === "schedule"
    ) {
      if (focusTaskDialogField(pending.dialog)) dialogHandoff.current = null;
    }
  }, [
    dialogBusy,
    showCreate,
    reworkOpen,
    acceptTarget,
    confirmExecute,
    confirmRerun,
    confirmSchedule,
  ]);

  const dismissDialog = (close: () => void) => {
    if (dialogLock.current) return;
    close();
  };

  const handleCreate = async () => {
    const submitted = { ...briefLive.current };
    const title = submitted.title.trim();
    const goal = submitted.objective.trim();
    if (!title || !goal) return;
    const files = submitted.filePaths
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((path) => ({ path }));
    const email = {
      enabled: submitted.emailEnabled,
      query: submitted.emailQuery.trim(),
      days: Math.max(0, Number(submitted.emailDays) || 3),
    };
    if (!beginDialog()) return;
    let handoff: TaskDialogHandoff | null = null;
    try {
      const item = await createProjectBrief({
        title,
        objective: goal,
        source_scope: { email, files },
      });
      if (sameBrief(briefLive.current, submitted)) {
        briefLive.current = {
          ...briefLive.current,
          title: "",
          objective: "",
          emailQuery: "",
          filePaths: "",
        };
        setShowCreate(false);
        setNewTitle("");
        setObjective("");
        setEmailQuery("");
        setFilePaths("");
      } else {
        handoff = { kind: "kept", dialog: "create" };
      }
      invalidate();
      if (!handoff) navigate(`/tasks/${item.id}`);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建任务失败", "任务");
      handoff = { kind: "failed", dialog: "create" };
    } finally {
      dialogHandoff.current = handoff;
      endDialog();
    }
  };

  const handleExecute = async () => {
    if (!selected || !beginDialog()) return;
    let handoff: TaskDialogHandoff | null = null;
    try {
      await executeWorkItem(selected.id);
      setConfirmExecute(false);
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "启动任务失败", "任务");
      handoff = { kind: "failed", dialog: "execute" };
    } finally {
      dialogHandoff.current = handoff;
      endDialog();
    }
  };

  const handleRerun = async () => {
    if (!selected || !beginDialog()) return;
    let handoff: TaskDialogHandoff | null = null;
    try {
      await rerunProjectBrief(selected.id);
      setConfirmRerun(false);
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "再次运行失败", "任务");
      handoff = { kind: "failed", dialog: "rerun" };
    } finally {
      dialogHandoff.current = handoff;
      endDialog();
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
    if (!selected) return;
    const submitted = { ...scheduleLive.current };
    const delay = scheduleDelay();
    if (!delay || !beginDialog()) return;
    let handoff: TaskDialogHandoff | null = null;
    try {
      const scheduled = await scheduleBriefRepeat(selected.id, delay);
      if (
        scheduleLive.current.hours === submitted.hours &&
        scheduleLive.current.minutes === submitted.minutes
      ) {
        setConfirmSchedule(false);
      } else {
        handoff = { kind: "kept", dialog: "schedule" };
      }
      setScheduledRepeatNote(
        scheduled.fire_at
          ? `已设定，将在 ${scheduled.fire_at} 再次运行这一份任务。`
          : "已设定，到点后再次运行这一份任务。",
      );
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "设定定时失败", "任务");
      handoff = { kind: "failed", dialog: "schedule" };
    } finally {
      dialogHandoff.current = handoff;
      endDialog();
    }
  };

  const handleCancel = async () => {
    if (!selected) return;
    const taskId = selected.id;
    if (!beginDirect(taskId, "cancel")) return;
    let handoff: TaskDirectHandoff | null = null;
    try {
      await cancelWorkItem(taskId);
      handoff = { taskId, kind: "cancel" };
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "取消任务失败", "任务");
    } finally {
      endDirect(taskId, handoff);
    }
  };

  const handleAccept = async () => {
    if (!selected || !acceptTarget || !beginDialog()) return;
    const submitted = acceptLive.current;
    const note = submitted.trim();
    if (!acceptKey.current) acceptKey.current = newIdempotencyKey("accept");
    let handoff: TaskDialogHandoff | null = null;
    try {
      await acceptWorkDelivery(selected.id, acceptTarget.delivery_id, {
        ...(note ? { reason: note } : {}),
        idempotency_key: acceptKey.current,
      });
      acceptKey.current = null;
      if (acceptLive.current === submitted) {
        setAcceptTarget(null);
        setAcceptNote("");
        acceptLive.current = "";
      } else {
        handoff = { kind: "kept", dialog: "accept" };
      }
      invalidate();
      setMetricsRefresh((value) => value + 1);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "验收失败", "任务");
      handoff = { kind: "failed", dialog: "accept" };
    } finally {
      dialogHandoff.current = handoff;
      endDialog();
    }
  };

  const handleAdopt = async (delivery: WorkDelivery, actionIndex: number) => {
    if (!selected) return;
    const taskId = selected.id;
    if (!beginDirect(taskId, `adopt:${actionIndex}`)) return;
    if (!adoptKeys.current[actionIndex]) {
      adoptKeys.current[actionIndex] = newIdempotencyKey("adopt");
    }
    let handoff: TaskDirectHandoff | null = null;
    try {
      await adoptSuggestedAction(taskId, delivery.delivery_id, actionIndex, {
        idempotency_key: adoptKeys.current[actionIndex],
      });
      handoff = { taskId, kind: "adopt", index: actionIndex };
      invalidate();
      setMetricsRefresh((value) => value + 1);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "转为任务失败", "任务");
    } finally {
      endDirect(taskId, handoff);
    }
  };

  const handleComplete = async () => {
    if (!selected) return;
    const taskId = selected.id;
    if (!beginDirect(taskId, "complete")) return;
    let handoff: TaskDirectHandoff | null = null;
    try {
      await updateWorkItemStatus(taskId, "completed");
      handoff = { taskId, kind: "complete" };
      invalidate();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "完成任务失败", "任务");
    } finally {
      endDirect(taskId, handoff);
    }
  };

  const openCitedSource = async (sourceId: string, sources: readonly DeliverySourceRef[]) => {
    const matched = findDeliverySource(sources, sourceId);
    const targetId = matched?.id ?? sourceId.trim();
    setActiveSourceId(targetId || null);
    scrollToDeliverySource(targetId);
    const messageId = matched ? emailMessageId(matched) : null;
    if (!messageId) {
      citeRequest.current += 1;
      citeInflight.current = null;
      setCiteSourceId(null);
      setCiteMessageId(null);
      setCiteError(null);
      setCiteLoadingId(null);
      return;
    }
    // 同一封还在读时再点不另发。来源按钮保持可聚焦，避免焦点卸到页面空白处。
    if (citeInflight.current === messageId) return;
    const requestId = ++citeRequest.current;
    citeInflight.current = messageId;
    setCiteSourceId(targetId);
    setCiteMessageId(messageId);
    setCiteLoadingId(messageId);
    setCiteError(null);
    try {
      const detail = await getInboxEmailDetail(messageId);
      if (citeRequest.current !== requestId) return;
      setInboxEmail(detail);
      setCiteSourceId(null);
      setCiteMessageId(null);
      setCiteError(null);
    } catch (err) {
      if (citeRequest.current !== requestId) return;
      setCiteError(err);
      addError(queryErrorMessage(err, "加载邮件详情失败"), "任务");
    } finally {
      if (citeRequest.current === requestId) {
        setCiteLoadingId(null);
        citeInflight.current = null;
      }
    }
  };

  const handleRework = async () => {
    if (!selected) return;
    const current = selected.delivery_bundle?.current;
    const submitted = reworkLive.current;
    const reason = submitted.trim();
    if (!current || !reason || !beginDialog()) return;
    let handoff: TaskDialogHandoff | null = null;
    try {
      await reworkWorkDelivery(selected.id, current.delivery_id, {
        reason,
        idempotency_key: newIdempotencyKey("rework"),
      });
      if (reworkLive.current === submitted) {
        setReworkOpen(false);
        setReworkReason("");
        reworkLive.current = "";
      } else {
        handoff = { kind: "kept", dialog: "rework" };
      }
      invalidate();
      setMetricsRefresh((value) => value + 1);
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "返工失败", "任务");
      handoff = { kind: "failed", dialog: "rework" };
    } finally {
      dialogHandoff.current = handoff;
      endDialog();
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
              <Link
                to={taskPageHref(item.id)}
                aria-current={active ? "page" : undefined}
                data-task-current={active ? "" : undefined}
                className={`block w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
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
              </Link>
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
  const openDeliveryId = viewingHistory ? historyId : currentDelivery?.delivery_id;
  const citeSources = shownDelivery
    ? citationLookupSources(
        shownDelivery.sources,
        comparedSourceCandidates(shownDelivery, bundle?.deliveries),
      )
    : [];
  const canCiteDeliverySource = (sourceId: string) =>
    findDeliverySource(citeSources, sourceId) !== undefined;

  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || actionBusy) return;
    if (!selected || pending.taskId !== selected.id) {
      focusAfter.current = null;
      return;
    }
    if (pending.kind === "complete") {
      if (canComplete) return;
    } else if (pending.kind === "cancel") {
      if (canCancel) return;
    } else {
      const adopted = currentDelivery?.suggested_actions[pending.index ?? -1]?.adopted_work_id;
      if (!adopted) return;
    }
    focusAfter.current = null;
    if (!focusIsIdle()) return;
    placeDirectActionFocus(pending);
  }, [selected, actionBusy, canComplete, canCancel, currentDelivery]);

  useEffect(() => {
    if (!viewingHistory || !historyFull) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    deliveryTitleRef.current?.focus();
  }, [viewingHistory, historyFull]);

  useLayoutEffect(() => {
    // 版本行在交付下面。换一版时上面的正文高度会变，视口容易停在版本列表上。
    // 把交付区滚到滚动容器顶部，焦点仍留在版本行。刚打开任务，或换任务清掉历史版时，不滚。
    const prev = deliveryScrollRef.current;
    const taskChanged = !prev || prev.taskId !== urlTaskId;
    let suppressNull = false;
    if (taskChanged) {
      suppressNull = historyId !== null;
    } else if (prev.suppressNull && historyId === null) {
      suppressNull = false;
    } else if (prev) {
      suppressNull = prev.suppressNull;
    }
    deliveryScrollRef.current = {
      taskId: urlTaskId,
      historyId,
      loading: historyLoading,
      suppressNull,
    };
    if (taskChanged || !prev) return;
    if (prev.suppressNull && historyId === null) return;
    const switched = prev.historyId !== historyId;
    const settled =
      prev.historyId === historyId && Boolean(historyId) && prev.loading && !historyLoading;
    if (!switched && !settled) return;
    const slot = deliverySlotRef.current;
    if (!slot || typeof slot.scrollIntoView !== "function") return;
    slot.scrollIntoView({ block: "start", inline: "nearest" });
  }, [urlTaskId, historyId, historyLoading]);

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

        {metricsError && !hasDeliveryMetrics(metrics) ? (
          <LoadErrorNotice
            message={metricsError}
            busy={metricsLoading}
            onRetry={() => {
              if (metricsLoading) return;
              setMetricsRefresh((value) => value + 1);
            }}
            testId="delivery-metrics-load-error"
            autoFocus={!detailOpen && !shownListError}
          />
        ) : null}

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
            <DeliveryMetricsWorks items={metrics.items} />
          </section>
        )}

        {shownListError && !detailOpen ? (
          <LoadErrorNotice
            message={shownListError}
            busy={listFetching}
            onRetry={() => void refetchTasks()}
            testId="tasks-load-error"
          />
        ) : isLoading && items.length === 0 && !detailOpen ? (
          <p className="text-sm text-fg-tertiary">加载中…</p>
        ) : showSplit ? (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <section
              aria-label="任务列表"
              data-task-list=""
              className={detailOpen ? "hidden min-w-0 lg:block" : "min-w-0"}
            >
              {shownListError ? (
                <LoadErrorNotice
                  message={shownListError}
                  busy={listFetching}
                  onRetry={() => void refetchTasks()}
                  testId="tasks-load-error"
                  autoFocus={false}
                />
              ) : isLoading && items.length === 0 ? (
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
                  <Link to="/tasks" data-task-back="" className={backLinkSecondary}>
                    返回列表
                  </Link>
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
                    <Link to="/tasks" className={backLinkPrimary}>
                      返回列表
                    </Link>
                  }
                />
              )}
              {shownDetailError ? (
                <LoadErrorNotice
                  message={shownDetailError}
                  busy={detailFetching}
                  onRetry={() => void refetchTask()}
                  testId="task-detail-load-error"
                />
              ) : urlTaskId && !selected && !notFound ? (
                <p className="py-14 text-center text-sm text-fg-tertiary">加载中…</p>
              ) : null}
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
                          <Button
                            size="sm"
                            data-task-action="complete"
                            aria-busy={actionBusy === "complete" || undefined}
                            className={actionBusy === "complete" ? "opacity-50" : ""}
                            onClick={() => void handleComplete()}
                          >
                            完成
                          </Button>
                        )}
                        {canExecute && (
                          <Button
                            size="sm"
                            data-task-action="execute"
                            onClick={() => openActionDialog(() => setConfirmExecute(true))}
                            aria-busy={busy || undefined}
                            className={busy ? "opacity-50" : ""}
                          >
                            {rerun ? "重新执行" : "执行"}
                          </Button>
                        )}
                        {canRerunSameBrief && (
                          <Button
                            size="sm"
                            data-task-action="rerun"
                            onClick={() => openActionDialog(() => setConfirmRerun(true))}
                            aria-busy={busy || undefined}
                            className={busy ? "opacity-50" : ""}
                          >
                            再次运行
                          </Button>
                        )}
                        {canRerunSameBrief && (
                          <Button
                            size="sm"
                            variant="secondary"
                            data-task-action="schedule"
                            onClick={() => openActionDialog(() => setConfirmSchedule(true))}
                            aria-busy={busy || undefined}
                            className={busy ? "opacity-50" : ""}
                          >
                            定时再次运行
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="subtle"
                            data-task-action="cancel"
                            aria-busy={actionBusy === "cancel" || undefined}
                            className={actionBusy === "cancel" ? "opacity-50" : ""}
                            onClick={() => void handleCancel()}
                          >
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

                  <div ref={deliverySlotRef} data-testid="delivery-slot" className="scroll-mt-3">
                    {viewingHistory && historyLoading && !historyError ? (
                      <div
                        className="flex min-h-32 items-center gap-2 rounded-xl border border-border-subtle p-4 text-sm text-fg-tertiary"
                        data-testid="history-load-status"
                        role="status"
                        aria-live="polite"
                        aria-busy="true"
                      >
                        <span aria-hidden="true" className="inline-flex">
                          <Spinner size="sm" />
                        </span>
                        加载历史版本全文…
                      </div>
                    ) : null}
                    {viewingHistory && historyError ? (
                      <div
                        ref={historyErrorRef}
                        className="space-y-2 rounded-xl border border-danger/30 p-4"
                        data-testid="history-load-error"
                        role="alert"
                      >
                        <p className="text-sm text-danger">{historyError}</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-busy={historyLoading || undefined}
                          onClick={() => {
                            if (historyLoading) return;
                            setHistoryRetry((attempt) => attempt + 1);
                          }}
                        >
                          {historyLoading ? (
                            <span aria-hidden="true" className="inline-flex">
                              <Spinner size="sm" />
                            </span>
                          ) : null}
                          重试
                        </Button>
                      </div>
                    ) : null}
                    {shownDelivery && failureReason ? (
                      <RerunFailureReason reason={failureReason} />
                    ) : null}
                    {shownDelivery ? (
                      <OpeningMailSourceContext.Provider
                        value={citeLoadingId ? citeSourceId : null}
                      >
                        <section className="space-y-3 rounded-xl border border-border-subtle p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3
                                ref={deliveryTitleRef}
                                tabIndex={-1}
                                className="rounded-sm text-sm font-medium text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                              >
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
                                  data-task-action="accept"
                                  onClick={() =>
                                    openActionDialog(() => setAcceptTarget(shownDelivery))
                                  }
                                  aria-busy={busy || undefined}
                                  className={busy ? "opacity-50" : ""}
                                >
                                  验收
                                </Button>
                                <Button
                                  size="sm"
                                  variant="subtle"
                                  data-task-action="rework"
                                  onClick={() => openActionDialog(() => setReworkOpen(true))}
                                  aria-busy={busy || undefined}
                                  className={busy ? "opacity-50" : ""}
                                >
                                  返工
                                </Button>
                              </div>
                            )}
                          </div>
                          <DeliveryChecks delivery={shownDelivery} />
                          <DeliveryVersionDiff
                            delivery={shownDelivery}
                            onCite={(sourceId) => void openCitedSource(sourceId, citeSources)}
                            canCite={canCiteDeliverySource}
                          />
                          <p className="text-sm text-fg-secondary whitespace-pre-wrap">
                            {shownDelivery.summary}
                          </p>
                          <pre
                            className="text-sm text-fg-primary whitespace-pre-wrap break-words bg-surface-sunken rounded-lg p-3"
                            data-testid="delivery-body"
                          >
                            <DeliveryBodyText
                              content={deliveryBodyText(shownDelivery.content)}
                              sources={shownDelivery.sources}
                              onCite={(sourceId) =>
                                void openCitedSource(sourceId, shownDelivery.sources)
                              }
                            />
                          </pre>
                          {shownDelivery.limitations.length > 0 && (
                            <div>
                              <h4 className="text-xs font-medium text-fg-tertiary mb-1">
                                限制与不足
                              </h4>
                              <ul className="text-sm text-warning space-y-1">
                                {shownDelivery.limitations.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <DeliveryFindings
                            delivery={shownDelivery}
                            onCite={(sourceId) =>
                              void openCitedSource(sourceId, shownDelivery.sources)
                            }
                          />
                          <DeliverySources
                            sources={shownDelivery.sources}
                            activeSourceId={activeSourceId}
                            onOpenEmail={(sourceId) =>
                              void openCitedSource(sourceId, shownDelivery.sources)
                            }
                          />
                          {shownCiteError ? (
                            <LoadErrorNotice
                              message={shownCiteError}
                              busy={citeBusy}
                              onRetry={() => {
                                if (!citeSourceId || citeBusy) return;
                                void openCitedSource(citeSourceId, citeSources);
                              }}
                              testId="task-mail-load-error"
                            />
                          ) : null}
                          {shownDelivery.suggested_actions.length > 0 && (
                            <div>
                              <h4 className="text-xs font-medium text-fg-tertiary mb-1">
                                建议待办
                              </h4>
                              <ul className="text-sm text-fg-secondary space-y-2">
                                {shownDelivery.suggested_actions.map((action, index) => {
                                  const adoptedHref = action.adopted_work_id
                                    ? adoptedTaskHref(action.adopted_work_id)
                                    : undefined;
                                  return (
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
                                        adoptedHref ? (
                                          <Link
                                            to={adoptedHref}
                                            data-task-adopted={index}
                                            className={adoptedLinkClass}
                                          >
                                            已转为任务
                                          </Link>
                                        ) : (
                                          <span className="shrink-0 px-3 py-1.5 text-xs text-fg-secondary">
                                            已转为任务
                                          </span>
                                        )
                                      ) : !viewingHistory ? (
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          data-task-adopt={index}
                                          aria-busy={actionBusy === `adopt:${index}` || undefined}
                                          className={
                                            actionBusy === `adopt:${index}` ? "opacity-50" : ""
                                          }
                                          onClick={() => void handleAdopt(shownDelivery, index)}
                                        >
                                          转为任务
                                        </Button>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </section>
                      </OpeningMailSourceContext.Provider>
                    ) : viewingHistory ? null : isProjectBrief(selected) ? (
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
                  </div>

                  {bundle && bundle.deliveries.length > 1 ? (
                    <DeliveryVersionHistory
                      rows={bundle.deliveries}
                      openDeliveryId={openDeliveryId}
                      historyLoading={historyLoading}
                      onOpen={(deliveryId) => {
                        if (deliveryId === currentDelivery?.delivery_id) {
                          setHistoryId(null);
                          return;
                        }
                        if (historyId === deliveryId) {
                          if (historyError && !historyLoading) {
                            setHistoryRetry((attempt) => attempt + 1);
                          }
                          return;
                        }
                        // 同一帧换上加载态，避免正文先被收成空交付再出现转圈。
                        setHistoryError(null);
                        setHistoryFull(null);
                        setHistoryLoading(true);
                        setHistoryId(deliveryId);
                      }}
                    />
                  ) : bundle && bundle.deliveries.length === 1 ? (
                    <p className="text-sm text-fg-tertiary" data-testid="delivery-single-version">
                      目前只有这一版。
                    </p>
                  ) : bundle && bundle.deliveries.length === 0 && isProjectBrief(selected) ? (
                    <p className="text-sm text-fg-tertiary" data-testid="delivery-version-empty">
                      还没有版本历史。
                    </p>
                  ) : null}

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
          open={confirmExecute && (dialogBusy || Boolean(selected && canExecute))}
          title="确认执行计划"
          description={formatPlanConfirmDescription(steps, resumeFrom)}
          confirmLabel={dialogBusy ? "执行中..." : "确认执行"}
          cancelLabel="取消"
          confirmBusy={dialogBusy}
          confirmMarker="execute"
          onConfirm={() => {
            void handleExecute();
          }}
          onCancel={() => dismissDialog(() => setConfirmExecute(false))}
        />

        <Dialog
          open={confirmRerun && (dialogBusy || canRerunSameBrief)}
          title="再次运行同一份简报"
          description="将重新执行这份简报，不另建任务，也不记成返工。完成后的新版本会对照当前这一版，显示相对上一版的变化。"
          confirmLabel={dialogBusy ? "再次运行中..." : "确认再次运行"}
          cancelLabel="取消"
          confirmBusy={dialogBusy}
          confirmMarker="rerun"
          onConfirm={() => {
            void handleRerun();
          }}
          onCancel={() => dismissDialog(() => setConfirmRerun(false))}
        />

        <Dialog
          open={confirmSchedule && (dialogBusy || canRerunSameBrief)}
          title="定时再次运行这一份简报"
          description="到点后只再次运行这一份任务。不会新开一份简报，也不会为这次触发另建交付。若到点时它已经不能再次运行，提醒只会打开这一份任务。"
          confirmLabel={dialogBusy ? "设定中..." : "确认定时"}
          cancelLabel="取消"
          confirmDisabled={scheduleDelay() === null}
          confirmBusy={dialogBusy}
          confirmMarker="schedule"
          onConfirm={() => {
            void handleScheduleRepeat();
          }}
          onCancel={() => dismissDialog(() => setConfirmSchedule(false))}
        >
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">小时</span>
              <Input
                inputMode="decimal"
                value={scheduleHours}
                data-task-dialog-field="schedule"
                onChange={(e) => {
                  scheduleLive.current = { ...scheduleLive.current, hours: e.target.value };
                  setScheduleHours(e.target.value);
                }}
                placeholder="0"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">分钟</span>
              <Input
                inputMode="decimal"
                value={scheduleMinutes}
                data-task-dialog-field="schedule"
                onChange={(e) => {
                  scheduleLive.current = { ...scheduleLive.current, minutes: e.target.value };
                  setScheduleMinutes(e.target.value);
                }}
                placeholder="0"
              />
            </label>
          </div>
        </Dialog>

        <Dialog
          open={showCreate}
          title="新建项目资料简报"
          description="指定资料范围、时间范围和验收要求。原始需求会保留在任务说明中。"
          confirmLabel={dialogBusy ? "创建中..." : "创建"}
          cancelLabel="取消"
          confirmDisabled={!newTitle.trim() || !objective.trim()}
          confirmBusy={dialogBusy}
          confirmMarker="create"
          onConfirm={() => {
            void handleCreate();
          }}
          onCancel={() => dismissDialog(() => setShowCreate(false))}
        >
          <div className="space-y-3 text-sm">
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">标题</span>
              <Input
                value={newTitle}
                data-task-dialog-field="create"
                onChange={(e) => {
                  briefLive.current = { ...briefLive.current, title: e.target.value };
                  setNewTitle(e.target.value);
                }}
                placeholder="项目 A 简报"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">目标与验收要求</span>
              <textarea
                className="w-full min-h-24 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
                value={objective}
                data-task-dialog-field="create"
                onChange={(e) => {
                  briefLive.current = { ...briefLive.current, objective: e.target.value };
                  setObjective(e.target.value);
                }}
                placeholder="整理最近三天的邮件和指定资料，列出变化、风险和建议待办。每条关键结论附来源。"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={emailEnabled}
                data-task-dialog-field="create"
                onChange={(e) => {
                  briefLive.current = { ...briefLive.current, emailEnabled: e.target.checked };
                  setEmailEnabled(e.target.checked);
                }}
              />
              <span>读取已配置邮箱</span>
            </label>
            {emailEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={emailQuery}
                  data-task-dialog-field="create"
                  onChange={(e) => {
                    briefLive.current = { ...briefLive.current, emailQuery: e.target.value };
                    setEmailQuery(e.target.value);
                  }}
                  placeholder="关键词（可选）"
                />
                <Input
                  value={emailDays}
                  data-task-dialog-field="create"
                  onChange={(e) => {
                    briefLive.current = { ...briefLive.current, emailDays: e.target.value };
                    setEmailDays(e.target.value);
                  }}
                  placeholder="最近天数"
                />
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-xs text-fg-tertiary">资料路径（每行一个）</span>
              <textarea
                className="w-full min-h-16 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
                value={filePaths}
                data-task-dialog-field="create"
                onChange={(e) => {
                  briefLive.current = { ...briefLive.current, filePaths: e.target.value };
                  setFilePaths(e.target.value);
                }}
                placeholder="C:\notes\project-a.md"
              />
            </label>
          </div>
        </Dialog>

        <Dialog
          open={Boolean(acceptTarget)}
          title="验收交付"
          description="可以留下验收说明。留空则直接验收，说明不会显示。"
          confirmLabel={dialogBusy ? "验收中..." : "确认验收"}
          cancelLabel="取消"
          confirmBusy={dialogBusy}
          confirmMarker="accept"
          onConfirm={() => {
            void handleAccept();
          }}
          onCancel={() => dismissDialog(() => setAcceptTarget(null))}
        >
          <textarea
            className="w-full min-h-24 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
            value={acceptNote}
            data-task-dialog-field="accept"
            onChange={(e) => {
              acceptLive.current = e.target.value;
              setAcceptNote(e.target.value);
            }}
            placeholder="例如：结论和来源都齐了。"
          />
        </Dialog>

        <Dialog
          open={reworkOpen}
          title="请求返工"
          description="请填写修改意见。旧版交付会保留，新执行使用原要求与本意见。"
          confirmLabel={dialogBusy ? "返工中..." : "确认返工"}
          cancelLabel="取消"
          confirmDisabled={!reworkReason.trim()}
          confirmBusy={dialogBusy}
          confirmMarker="rework"
          onConfirm={() => {
            void handleRework();
          }}
          onCancel={() => dismissDialog(() => setReworkOpen(false))}
        >
          <textarea
            className="w-full min-h-24 bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm"
            value={reworkReason}
            data-task-dialog-field="rework"
            onChange={(e) => {
              reworkLive.current = e.target.value;
              setReworkReason(e.target.value);
            }}
            placeholder="例如：补上风险，并给每条结论带来源。"
          />
        </Dialog>
        <InboxEmailDetailModal email={inboxEmail} onClose={() => setInboxEmail(null)} />
      </div>
    </div>
  );
}
