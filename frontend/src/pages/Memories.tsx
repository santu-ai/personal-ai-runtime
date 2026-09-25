import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createMemory,
  deleteMemory,
  updateMemory,
  ratifyMemory,
  rejectMemory,
  bulkClaimAction,
  getClaimConversionStats,
  getMemoryGraph,
  ApiError,
  type MemoryRow,
  type MemoryGraph,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { useQuickChat } from "../hooks/useQuickChat";
import { useMemoriesGroupedQuery, useProposedMemoryCountQuery } from "../hooks/useMemoriesQuery";
import { queryKeys } from "../hooks/useWsInvalidationBridge";
import { PortraitPanel } from "./Portrait";
import Dialog from "../components/ui/Dialog";
import { useOverlayDismiss } from "../components/ui/useOverlayDismiss";
import LoadErrorNotice, {
  queryErrorMessage,
  useHeldQueryError,
} from "../components/ui/LoadErrorNotice";
import PageHeader from "../components/ui/PageHeader";
import SegmentedControl from "../components/ui/SegmentedControl";
import MemoryGraphView from "../components/memories/MemoryGraphView";
import MemoryListItem, {
  CATEGORY_LABELS,
  getCategoryMeta,
} from "../components/memories/MemoryListItem";
import MemoryProvenanceDialog from "../components/memories/MemoryProvenanceDialog";
import { Brain, ClipboardCheck, List, Network, User } from "lucide-react";

type ViewMode = "list" | "graph" | "portrait" | "review";
type ReviewOrder = "created_at_desc" | "created_at_asc";
type RatifyScope = "proposed" | "rejected" | "list";

type FocusAfter = {
  actedId: string;
  scope: RatifyScope;
  /** 还在列表里就回到这一行；离开了就去下一行。空的时候回到页面上还在的控件。 */
  targetId: string | null;
};

function isRatifiable(row: MemoryRow): boolean {
  return (
    row.origin === "claim" && (row.claim_status === "proposed" || row.claim_status === "rejected")
  );
}

function nextRatifyId(rows: readonly MemoryRow[], id: string): string | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  for (let i = index + 1; i < rows.length; i += 1) {
    if (isRatifiable(rows[i])) return rows[i].id;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isRatifiable(rows[i])) return rows[i].id;
  }
  return null;
}

/** 焦点在页面空白处，或还停在这次操作的按钮上，才可以把焦点挪走。 */
function focusIsIdle(actedId: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (active instanceof HTMLButtonElement) {
    if (active.disabled) return true;
    if (
      active.getAttribute("data-memory-action") === "ratify" &&
      active.getAttribute("data-memory-id") === actedId
    ) {
      return true;
    }
  }
  if (
    (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
    active.disabled
  ) {
    return true;
  }
  return false;
}

function focusRatify(id: string): boolean {
  for (const node of document.querySelectorAll<HTMLButtonElement>(
    'button[data-memory-action="ratify"]',
  )) {
    if (node.getAttribute("data-memory-id") !== id || node.disabled) continue;
    node.focus();
    return document.activeElement === node;
  }
  return false;
}

function captureField(): HTMLInputElement | null {
  const input = document.querySelector<HTMLInputElement>("[data-memory-anchor='capture']");
  if (!input || input.disabled) return null;
  return input;
}

function focusCaptureField(): boolean {
  const input = captureField();
  if (!input) return false;
  if (document.activeElement !== input) input.focus();
  return document.activeElement === input;
}

/** 焦点在页面空白处，或还停在这次「记住」的输入框或按钮上。 */
function captureFocusIdle(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  const anchor = active.getAttribute("data-memory-anchor");
  return anchor === "capture" || anchor === "remember";
}

type MemoryDraftDialog = "reject" | "edit";
type MemoryDialogHandoff =
  { kind: "failed"; dialog: MemoryDraftDialog } | { kind: "kept"; dialog: MemoryDraftDialog };

function focusMemoryDialogBlank(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("role") === "dialog";
}

function focusOnMemoryDialog(name: MemoryDraftDialog): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return (
    active.getAttribute("data-memory-dialog") === name ||
    active.getAttribute("data-memory-dialog-field") === name
  );
}

function focusMemoryDialogField(name: MemoryDraftDialog): boolean {
  const field = document.querySelector<HTMLElement>(`[data-memory-dialog-field="${name}"]`);
  if (!field) return false;
  if (field instanceof HTMLInputElement && field.disabled) return false;
  if (document.activeElement !== field) field.focus();
  return document.activeElement === field;
}

function focusMemoryDialogConfirm(name: MemoryDraftDialog): boolean {
  const button = document.querySelector<HTMLButtonElement>(`[data-memory-dialog="${name}"]`);
  if (!button || button.disabled) return false;
  if (document.activeElement !== button) button.focus();
  return document.activeElement === button;
}

type BulkAction = "ratify" | "reject";

type BulkHandoff = {
  action: BulkAction;
  failed: boolean;
  actedIds: string[];
};

function bulkButton(action: BulkAction): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[data-memory-bulk="${action}"]`);
}

/** 焦点在页面空白处，或还停在这次批量按钮上。 */
function bulkFocusIdle(action: BulkAction): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("data-memory-bulk") === action;
}

function focusBulk(action: BulkAction): boolean {
  const button = bulkButton(action);
  if (!button || button.disabled) return false;
  if (document.activeElement !== button) button.focus();
  return document.activeElement === button;
}

/** 落到还没被这次批量处理的待确认「确认」。 */
function focusProposedRatifyExcept(ids: readonly string[]): boolean {
  const acted = new Set(ids);
  for (const node of document.querySelectorAll<HTMLButtonElement>(
    'button[data-memory-action="ratify"][data-memory-scope="proposed"]',
  )) {
    const id = node.getAttribute("data-memory-id");
    if (!id || acted.has(id) || node.disabled) continue;
    if (document.activeElement !== node) node.focus();
    return document.activeElement === node;
  }
  return false;
}

/** 焦点在页面空白处。已经在别的控件上就不再抢。 */
function focusIsBlank(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

function focusContinueChat(memoryId: string): void {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(memoryId)
      : memoryId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  document.querySelector<HTMLButtonElement>(`button[data-memory-chat="${escaped}"]`)?.focus();
}

type ForgetHandoff = { id: string; nextId: string | null; anchor: "capture" | "tab" };

/** 绘制前通知。测试在忘掉确认框卸下的同一轮读取焦点。 */
export const memoryPageLayoutFocus = {
  notify: null as null | (() => void),
};

function escapeAttr(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 焦点在页面空白处，或还停在刚忘掉的那一行上。已经在别的控件上就不再抢。 */
function forgetFocusIdle(id: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("data-memory-forget") === id;
}

function focusForget(id: string): boolean {
  const node = document.querySelector<HTMLButtonElement>(
    `button[data-memory-forget="${escapeAttr(id)}"]`,
  );
  if (!node || node.disabled) return false;
  node.focus();
  return document.activeElement === node;
}

function neighborMemoryId(rows: readonly { id: string }[], id: string): string | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}

/** 忘掉已经成功。先从已读到的列表拿掉这一条，确认框关掉时这一行的按钮才不会把焦点拽回去。 */
function dropMemoryFromGroupedCache(qc: QueryClient, id: string) {
  qc.setQueriesData({ queryKey: queryKeys.memoriesGrouped }, (current: unknown) => {
    if (!current || typeof current !== "object" || !("memories" in current)) return current;
    const row = current as { memories?: MemoryRow[]; total?: number };
    if (!Array.isArray(row.memories) || !row.memories.some((item) => item.id === id)) {
      return current;
    }
    const memories = row.memories.filter((item) => item.id !== id);
    const removed = row.memories.length - memories.length;
    return {
      ...row,
      memories,
      total: Math.max(0, (row.total ?? row.memories.length) - removed),
    };
  });
}

function focusAnchor(scope: RatifyScope): boolean {
  if (scope === "list" && focusCaptureField()) return true;
  const tab = document.querySelector<HTMLButtonElement>(
    '[role="tablist"][aria-label="记忆视图"] [role="tab"][aria-selected="true"]',
  );
  if (!tab || tab.disabled) return false;
  tab.focus();
  return document.activeElement === tab;
}

export default function MemoriesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const viewMode: ViewMode =
    tabParam === "portrait"
      ? "portrait"
      : tabParam === "graph"
        ? "graph"
        : tabParam === "review"
          ? "review"
          : "list";
  const setViewMode = (mode: ViewMode) => {
    if (mode === "list") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: mode }, { replace: true });
    }
  };

  const [reviewCategory, setReviewCategory] = useState<string>("");
  const [reviewOrder, setReviewOrder] = useState<ReviewOrder>("created_at_desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const bulkBusyRef = useRef(false);
  const bulkHandoff = useRef<BulkHandoff | null>(null);
  const ratifyingRef = useRef(new Set<string>());
  const [ratifying, setRatifying] = useState<Set<string>>(() => new Set());
  const focusAfter = useRef<FocusAfter | null>(null);

  const {
    data,
    isLoading: loading,
    isFetching: listFetching,
    error: loadError,
    refetch: refetchMemories,
  } = useMemoriesGroupedQuery();
  const {
    data: proposedData,
    isLoading: proposedLoading,
    isFetching: proposedFetching,
    error: reviewError,
    refetch: refetchReview,
  } = useMemoriesGroupedQuery({
    claimStatus: "proposed",
    category: reviewCategory || undefined,
    order: reviewOrder,
    limit: 100,
  });
  const { data: proposedTotal = 0 } = useProposedMemoryCountQuery();
  const {
    data: rejectedData,
    isFetching: rejectedFetching,
    error: rejectedError,
    refetch: refetchRejected,
  } = useMemoriesGroupedQuery({
    claimStatus: "rejected",
    limit: 50,
    order: "created_at_desc",
  });
  const { data: claimStats } = useQuery({
    queryKey: ["memory", "claim-stats"],
    queryFn: () => getClaimConversionStats(30),
    staleTime: 10_000,
  });
  const memories = data?.memories ?? [];
  const proposedMemories = proposedData?.memories ?? [];
  const rejectedMemories = rejectedData?.memories ?? [];
  const filteredTotal = proposedData?.total ?? proposedMemories.length;
  const shownListError = useHeldQueryError(
    Boolean(data),
    loadError,
    listFetching,
    "加载记忆失败",
    "list",
  );
  const shownReviewError = useHeldQueryError(
    Boolean(proposedData),
    reviewError,
    proposedFetching,
    "加载待确认记忆失败",
    `${reviewCategory}|${reviewOrder}`,
  );
  const shownRejectedError = useHeldQueryError(
    Boolean(rejectedData),
    rejectedError,
    rejectedFetching,
    "加载已拒绝记忆失败",
    "rejected",
  );
  // First visit only — filter changes keep placeholderData so the page stays up.
  const reviewInitialLoading = viewMode === "review" && proposedLoading && !proposedData;
  const addError = useErrorStore((s) => s.addError);
  const quickChat = useQuickChat();
  const chatLock = useRef(false);
  const [chattingId, setChattingId] = useState<string | null>(null);
  const chatFailId = useRef<string | null>(null);

  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const captureHandoff = useRef<"success" | "failed" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const forgetHandoff = useRef<ForgetHandoff | null>(null);
  const [rejectTarget, setRejectTarget] = useState<MemoryRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const rejectingRef = useRef(false);
  const rejectLive = useRef("");
  const [editTarget, setEditTarget] = useState<MemoryRow | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const editLive = useRef({ content: "", category: "" });
  const dialogHandoff = useRef<MemoryDialogHandoff | null>(null);
  const [provenanceTarget, setProvenanceTarget] = useState<MemoryRow | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphAttempt, setGraphAttempt] = useState(0);

  const invalidateMemories = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.memories }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memoriesGrouped }),
      queryClient.invalidateQueries({ queryKey: ["memory", "claim-stats"] }),
    ]);

  // Drop selections that left the current page after filter/refresh.
  useEffect(() => {
    const visible = new Set(proposedMemories.map((m) => m.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [proposedMemories]);

  const allPageSelected =
    proposedMemories.length > 0 && proposedMemories.every((m) => selectedIds.has(m.id));

  const grouped = useMemo(() => {
    const map: Record<string, MemoryRow[]> = {};
    for (const m of memories) {
      const cat = m.category || "其他";
      if (!map[cat]) map[cat] = [];
      map[cat].push(m);
    }
    return map;
  }, [memories]);

  useEffect(() => {
    if (loadError) {
      addError(queryErrorMessage(loadError, "加载记忆失败"), "记忆");
    }
  }, [loadError, addError]);

  useEffect(() => {
    if (viewMode === "review" && reviewError) {
      addError(queryErrorMessage(reviewError, "加载待确认记忆失败"), "记忆");
    }
  }, [viewMode, reviewError, addError]);

  useEffect(() => {
    if (viewMode === "review" && rejectedError) {
      addError(queryErrorMessage(rejectedError, "加载已拒绝记忆失败"), "记忆");
    }
  }, [viewMode, rejectedError, addError]);

  const handleCreate = async () => {
    const content = newContent.trim();
    if (!content || creatingRef.current) return;
    const submitted = newContent;
    creatingRef.current = true;
    captureHandoff.current = null;
    setCreating(true);
    let ok = false;
    try {
      await createMemory({ content, category: "fact" });
      ok = true;
      setNewContent((current) => (current === submitted ? "" : current));
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建记忆失败", "记忆");
    } finally {
      captureHandoff.current = ok ? "success" : "failed";
      creatingRef.current = false;
      setCreating(false);
    }
  };

  // 清掉内容会禁用「记住」。放到绘制前，观察 DOM 的那一轮才不会停在已经禁用的按钮上。
  useLayoutEffect(() => {
    if (creating) return;
    const pending = captureHandoff.current;
    if (!pending) return;
    captureHandoff.current = null;
    if (pending === "failed") {
      const active = document.activeElement;
      const lost =
        !active ||
        active === document.body ||
        active === document.documentElement ||
        (active instanceof HTMLElement && !active.isConnected);
      if (lost) focusCaptureField();
      return;
    }
    if (!captureFocusIdle()) return;
    focusCaptureField();
  }, [creating]);

  const confirmDelete = async () => {
    if (!deleteTarget || deletingRef.current) return;
    const id = deleteTarget.id;
    const rows =
      viewMode === "review"
        ? [...proposedMemories, ...rejectedMemories]
        : Object.values(grouped).flat();
    const nextId = neighborMemoryId(rows, id);
    const anchor: ForgetHandoff["anchor"] = viewMode === "list" ? "capture" : "tab";
    deletingRef.current = true;
    forgetHandoff.current = null;
    setDeleting(true);
    let removed = false;
    try {
      await deleteMemory(id);
      dropMemoryFromGroupedCache(queryClient, id);
      setDeleteTarget(null);
      removed = true;
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "删除记忆失败", "记忆");
    } finally {
      if (removed) forgetHandoff.current = { id, nextId, anchor };
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  // 确认框卸下的同一轮就把焦点交到下一行。放到绘制前，不把焦点留在页面空白。
  useLayoutEffect(() => {
    if (deleting) return;
    const pending = forgetHandoff.current;
    if (!pending) return;
    forgetHandoff.current = null;
    if (!forgetFocusIdle(pending.id)) return;
    if (pending.nextId && focusForget(pending.nextId)) return;
    if (pending.anchor === "capture") {
      focusCaptureField();
      return;
    }
    focusAnchor("proposed");
  }, [deleting, memories, proposedMemories, rejectedMemories, grouped, viewMode]);

  const confirmEdit = async () => {
    if (!editTarget || editingRef.current) return;
    const submitted = { ...editLive.current };
    const content = submitted.content.trim();
    if (!content) return;
    const id = editTarget.id;
    editingRef.current = true;
    dialogHandoff.current = null;
    setEditing(true);
    let handoff: MemoryDialogHandoff | null = null;
    try {
      await updateMemory(id, { content, category: submitted.category || undefined });
      if (
        editLive.current.content === submitted.content &&
        editLive.current.category === submitted.category
      ) {
        editLive.current = { content: "", category: "" };
        setEditTarget(null);
        setEditContent("");
        setEditCategory("");
      } else {
        handoff = { kind: "kept", dialog: "edit" };
      }
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新记忆失败", "记忆");
      handoff = { kind: "failed", dialog: "edit" };
    } finally {
      dialogHandoff.current = handoff;
      editingRef.current = false;
      setEditing(false);
    }
  };

  const rowsInScope = (scope: RatifyScope): MemoryRow[] => {
    if (scope === "rejected") return rejectedMemories;
    if (scope === "proposed") return proposedMemories;
    return Object.values(grouped).flat();
  };

  const scopeFor = (id: string): RatifyScope => {
    if (viewMode === "review" && rejectedMemories.some((row) => row.id === id)) return "rejected";
    if (viewMode === "review") return "proposed";
    return "list";
  };

  const beginRatify = (id: string) => {
    if (ratifyingRef.current.has(id)) return false;
    ratifyingRef.current.add(id);
    setRatifying(new Set(ratifyingRef.current));
    return true;
  };

  const endRatify = (id: string) => {
    ratifyingRef.current.delete(id);
    setRatifying(new Set(ratifyingRef.current));
  };

  const freshRows = (scope: RatifyScope): MemoryRow[] | null => {
    const entries = queryClient.getQueriesData<{ memories?: MemoryRow[] }>({
      queryKey: queryKeys.memoriesGrouped,
    });
    for (const [key, data] of entries) {
      if (key.includes("count")) continue;
      const opts = key[key.length - 1];
      if (!opts || typeof opts !== "object") continue;
      const record = opts as Record<string, unknown>;
      const claimStatus = record.claimStatus;
      const matches =
        scope === "proposed"
          ? claimStatus === "proposed" && record.limit === 100
          : scope === "rejected"
            ? claimStatus === "rejected" && record.limit === 50
            : claimStatus == null && record.limit == null && record.order == null;
      if (!matches) continue;
      return Array.isArray(data?.memories) ? data.memories : null;
    }
    return null;
  };

  const handleRatify = async (m: MemoryRow) => {
    if (!beginRatify(m.id)) return;
    const scope = scopeFor(m.id);
    const nextId = nextRatifyId(rowsInScope(scope), m.id);
    focusAfter.current = { actedId: m.id, scope, targetId: m.id };
    let failed = false;
    try {
      await ratifyMemory(m.id);
      try {
        await invalidateMemories();
      } catch {
        // 写已经成功。列表没刷新时这一行还在，焦点留在按钮上。
      }
    } catch (err) {
      failed = true;
      addError(err instanceof ApiError ? err.message : "确认记忆失败", "记忆");
    } finally {
      if (!failed) {
        const rows = freshRows(scope) ?? rowsInScope(scope);
        const stayed = rows.some((row) => row.id === m.id && isRatifiable(row));
        const nextOk = nextId != null && rows.some((row) => row.id === nextId && isRatifiable(row));
        focusAfter.current = {
          actedId: m.id,
          scope,
          targetId: stayed ? m.id : nextOk ? nextId : null,
        };
      }
      endRatify(m.id);
    }
  };

  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || ratifying.has(pending.actedId)) return;
    if (!focusIsIdle(pending.actedId)) {
      focusAfter.current = null;
      return;
    }
    if (pending.targetId) {
      if (focusRatify(pending.targetId)) focusAfter.current = null;
      return;
    }
    if (focusAnchor(pending.scope)) focusAfter.current = null;
  }, [ratifying, memories, proposedMemories, rejectedMemories, grouped, viewMode]);

  const handleReject = (m: MemoryRow) => {
    if (ratifyingRef.current.has(m.id) || rejectingRef.current) return;
    rejectLive.current = "";
    setRejectTarget(m);
    setRejectReason("");
  };

  const confirmReject = async () => {
    if (!rejectTarget || rejectingRef.current) return;
    const id = rejectTarget.id;
    const submitted = rejectLive.current;
    const reason = submitted.trim();
    rejectingRef.current = true;
    dialogHandoff.current = null;
    setRejecting(true);
    let handoff: MemoryDialogHandoff | null = null;
    try {
      await rejectMemory(id, reason);
      if (rejectLive.current === submitted) {
        rejectLive.current = "";
        setRejectTarget(null);
        setRejectReason("");
      } else {
        handoff = { kind: "kept", dialog: "reject" };
      }
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "拒绝记忆失败", "记忆");
      handoff = { kind: "failed", dialog: "reject" };
    } finally {
      dialogHandoff.current = handoff;
      rejectingRef.current = false;
      setRejecting(false);
    }
  };

  useEffect(() => {
    if (rejecting || editing) return;
    const pending = dialogHandoff.current;
    if (!pending) return;
    if (pending.kind === "kept") {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active.getAttribute("data-memory-dialog-field") === pending.dialog
      ) {
        dialogHandoff.current = null;
        return;
      }
      if (focusOnMemoryDialog(pending.dialog) || focusMemoryDialogBlank()) {
        if (focusMemoryDialogField(pending.dialog)) dialogHandoff.current = null;
        return;
      }
      dialogHandoff.current = null;
      return;
    }
    if (focusOnMemoryDialog(pending.dialog)) {
      dialogHandoff.current = null;
      return;
    }
    if (!focusMemoryDialogBlank()) {
      dialogHandoff.current = null;
      return;
    }
    if (focusMemoryDialogConfirm(pending.dialog)) {
      dialogHandoff.current = null;
      return;
    }
    if (focusMemoryDialogField(pending.dialog)) dialogHandoff.current = null;
  }, [rejecting, editing, rejectTarget, editTarget]);

  const toggleSelect = (m: MemoryRow) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(proposedMemories.map((m) => m.id)));
  };

  const handleBulk = async (action: BulkAction) => {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    bulkHandoff.current = { action, failed: false, actedIds: ids };
    setBulkAction(action);
    let failed = false;
    try {
      const result = await bulkClaimAction(action, ids);
      setSelectedIds(new Set());
      invalidateMemories();
      if (result.skipped.length > 0) {
        addError(`已处理 ${result.ok} 条，跳过 ${result.skipped.length} 条`, "记忆");
      }
    } catch (err) {
      failed = true;
      addError(
        err instanceof ApiError
          ? err.message
          : action === "ratify"
            ? "批量确认失败"
            : "批量拒绝失败",
        "记忆",
      );
    } finally {
      if (bulkHandoff.current) bulkHandoff.current = { ...bulkHandoff.current, failed };
      bulkBusyRef.current = false;
      setBulkAction(null);
    }
  };

  // 清掉选中会禁用批量按钮。放到绘制前，观察 DOM 的那一轮才不会停在已经禁用的按钮上。
  useLayoutEffect(() => {
    if (bulkAction) return;
    const pending = bulkHandoff.current;
    if (!pending) return;
    if (!bulkFocusIdle(pending.action)) {
      bulkHandoff.current = null;
      return;
    }
    if (pending.failed) {
      if (focusBulk(pending.action)) bulkHandoff.current = null;
      return;
    }
    if (focusProposedRatifyExcept(pending.actedIds) || focusAnchor("proposed")) {
      bulkHandoff.current = null;
    }
  }, [bulkAction, proposedMemories]);

  const handleEdit = (m: MemoryRow) => {
    if (editingRef.current) return;
    const content = m.content;
    const category = m.category || "fact";
    editLive.current = { content, category };
    setEditTarget(m);
    setEditContent(content);
    setEditCategory(category);
  };

  const handleContinueChat = (m: MemoryRow) => {
    if (chatLock.current) return;
    const memoryId = m.id;
    chatLock.current = true;
    chatFailId.current = null;
    setChattingId(memoryId);
    void (async () => {
      const ok =
        (await quickChat({
          title: "记忆讨论",
          prompt: `基于以下记忆继续讨论：\n${m.content}`,
        })) === true;
      chatLock.current = false;
      if (!ok) chatFailId.current = memoryId;
      setChattingId(null);
    })();
  };

  useLayoutEffect(() => {
    if (chattingId) return;
    const memoryId = chatFailId.current;
    if (!memoryId) return;
    chatFailId.current = null;
    if (focusIsBlank()) focusContinueChat(memoryId);
  }, [chattingId]);

  useEffect(() => {
    if (viewMode !== "graph" || graphData) return;
    let cancelled = false;
    setGraphLoading(true);
    (async () => {
      try {
        const next = await getMemoryGraph(30);
        if (cancelled) return;
        if (!next || !Array.isArray(next.nodes)) {
          setGraphError("加载记忆图谱失败");
          addError("加载记忆图谱失败", "记忆");
          return;
        }
        setGraphData(next);
        setGraphError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = queryErrorMessage(err, "加载记忆图谱失败");
        setGraphError(msg);
        addError(msg, "记忆");
      } finally {
        if (!cancelled) setGraphLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, graphData, graphAttempt, addError]);

  const rejectPanelRef = useRef<HTMLDivElement>(null);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const rejectTitleId = useId();
  const editTitleId = useId();
  useOverlayDismiss(
    rejectTarget != null,
    rejectPanelRef,
    () => {
      if (rejectingRef.current) return;
      setRejectTarget(null);
    },
    { initialFocus: "field" },
  );
  useOverlayDismiss(
    editTarget != null,
    editPanelRef,
    () => {
      if (editingRef.current) return;
      setEditTarget(null);
    },
    { initialFocus: "field" },
  );

  useLayoutEffect(() => {
    memoryPageLayoutFocus.notify?.();
  });

  // 列表或待确认重试一开始会把 isLoading 再置上。已经写出的失败要留在页面上。
  if (
    (loading && !shownListError && !shownReviewError) ||
    (reviewInitialLoading && !shownReviewError)
  ) {
    return <div className="flex-1 flex items-center justify-center text-fg-tertiary">加载中…</div>;
  }

  return (
    <div className="page-shell">
      <div className="page-container space-y-6">
        <PageHeader
          title="AI 对你的理解"
          description={
            <>
              这些是我从我们的对话中记住的。{memories.length > 0 && `共 ${memories.length} 条。`}
              {proposedTotal > 0 && (
                <span className="text-warning"> 其中 {proposedTotal} 条待你确认。</span>
              )}
              每一条都让我更好地帮助你。
            </>
          }
          actions={
            <SegmentedControl
              aria-label="记忆视图"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "list", label: "列表", icon: <List size={14} /> },
                {
                  value: "review",
                  label: "待确认",
                  icon: <ClipboardCheck size={14} />,
                  badge:
                    proposedTotal > 0 ? (
                      <span className="ml-0.5 text-[10px] min-w-[1.1rem] h-4 px-1 rounded-full bg-warning/20 text-warning flex items-center justify-center">
                        {proposedTotal > 99 ? "99+" : proposedTotal}
                      </span>
                    ) : undefined,
                },
                { value: "graph", label: "图谱", icon: <Network size={14} /> },
                { value: "portrait", label: "画像", icon: <User size={14} /> },
              ]}
            />
          }
        />

        {viewMode === "portrait" ? (
          <PortraitPanel compact />
        ) : viewMode === "review" ? (
          <>
            <p className="text-sm text-fg-secondary">
              以下记忆由对话推断而来，确认后才会进入聊天上下文；拒绝则不会再被召回。
            </p>
            {claimStats && (
              <p className="text-xs text-fg-tertiary" data-testid="claim-conversion-stats">
                近 {claimStats.days} 天：确认 {claimStats.ratified} · 拒绝 {claimStats.rejected}
                {claimStats.auto_expired > 0 && ` · 系统清理 ${claimStats.auto_expired}`}
                {claimStats.conversion_rate != null &&
                  ` · 转化率 ${Math.round(claimStats.conversion_rate * 100)}%`}
                {claimStats.false_positive_rate != null &&
                  ` · 误报率 ${Math.round(claimStats.false_positive_rate * 100)}%`}
                {` · 待确认 ${claimStats.proposed_open}`}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-fg-secondary flex items-center gap-1.5">
                分类
                <select
                  value={reviewCategory}
                  onChange={(e) => setReviewCategory(e.target.value)}
                  className="bg-surface-raised border border-border-subtle rounded px-2 py-1 text-sm text-fg-primary"
                >
                  <option value="">全部</option>
                  {Object.entries(CATEGORY_LABELS).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-fg-secondary flex items-center gap-1.5">
                排序
                <select
                  value={reviewOrder}
                  onChange={(e) => setReviewOrder(e.target.value as ReviewOrder)}
                  className="bg-surface-raised border border-border-subtle rounded px-2 py-1 text-sm text-fg-primary"
                >
                  <option value="created_at_desc">最新优先</option>
                  <option value="created_at_asc">最早优先</option>
                </select>
              </label>
              <span className="text-xs text-fg-tertiary">
                显示 {proposedMemories.length}
                {filteredTotal > proposedMemories.length ? ` / 筛选共 ${filteredTotal}` : ""}
                {proposedTotal !== filteredTotal ? `（全部待确认 ${proposedTotal}）` : ""}
                {proposedFetching && !proposedLoading ? " · 更新中…" : ""}
              </span>
            </div>

            {proposedMemories.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 py-2 border-y border-border-subtle">
                <label className="text-sm text-fg-secondary flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectAllPage}
                    className="rounded border-border-strong"
                  />
                  全选当前页（{proposedMemories.length}）
                </label>
                <button
                  type="button"
                  data-memory-bulk="ratify"
                  disabled={selectedIds.size === 0}
                  aria-busy={bulkAction === "ratify" || undefined}
                  onClick={() => void handleBulk("ratify")}
                  className={`px-3 py-1.5 text-sm rounded-lg bg-success/15 text-success hover:bg-success/25 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${bulkAction === "ratify" ? " opacity-50" : ""}`}
                >
                  批量确认（{selectedIds.size}）
                </button>
                <button
                  type="button"
                  data-memory-bulk="reject"
                  disabled={selectedIds.size === 0}
                  aria-busy={bulkAction === "reject" || undefined}
                  onClick={() => void handleBulk("reject")}
                  className={`px-3 py-1.5 text-sm rounded-lg bg-surface-overlay text-fg-secondary hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${bulkAction === "reject" ? " opacity-50" : ""}`}
                >
                  批量拒绝（{selectedIds.size}）
                </button>
              </div>
            )}

            {shownReviewError ? (
              <LoadErrorNotice
                message={shownReviewError}
                busy={proposedFetching}
                onRetry={() => void refetchReview()}
                testId="memories-review-load-error"
              />
            ) : proposedMemories.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-fg-tertiary text-sm">
                  {reviewCategory ? "该分类下没有待确认的记忆。" : "没有待确认的记忆。"}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {proposedMemories.map((m) => (
                  <MemoryListItem
                    key={m.id}
                    memory={m}
                    selected={selectedIds.has(m.id)}
                    onToggleSelect={toggleSelect}
                    ratifying={ratifying.has(m.id)}
                    onRatify={handleRatify}
                    onReject={handleReject}
                    onEdit={handleEdit}
                    onDelete={(row) => setDeleteTarget(row)}
                    chatting={chattingId === m.id}
                    onContinueChat={handleContinueChat}
                    onShowProvenance={setProvenanceTarget}
                  />
                ))}
              </ul>
            )}

            {shownRejectedError ? (
              <div className="pt-4">
                <LoadErrorNotice
                  message={shownRejectedError}
                  busy={rejectedFetching}
                  onRetry={() => void refetchRejected()}
                  testId="memories-rejected-load-error"
                  autoFocus={false}
                />
              </div>
            ) : rejectedMemories.length > 0 ? (
              <section className="pt-4">
                <h3 className="text-sm font-semibold text-fg-secondary mb-3">已拒绝</h3>
                <p className="text-xs text-fg-tertiary mb-2">
                  拒绝后不会进入对话。若判断有误，可恢复为已确认。
                </p>
                <ul className="space-y-2">
                  {rejectedMemories.map((m) => (
                    <MemoryListItem
                      key={m.id}
                      memory={m}
                      ratifying={ratifying.has(m.id)}
                      onRatify={handleRatify}
                      onReject={handleReject}
                      onEdit={handleEdit}
                      onDelete={(row) => setDeleteTarget(row)}
                      chatting={chattingId === m.id}
                      onContinueChat={handleContinueChat}
                      onShowProvenance={setProvenanceTarget}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : viewMode === "list" ? (
          <>
            <div className="flex gap-2">
              <input
                value={newContent}
                data-memory-anchor="capture"
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="告诉我一件关于你的事，我会记住..."
                className="flex-1 bg-surface-raised border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary outline-none focus:border-focus-ring"
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  void handleCreate();
                }}
              />
              <button
                type="button"
                data-memory-anchor="remember"
                onClick={() => void handleCreate()}
                disabled={!newContent.trim()}
                aria-busy={creating || undefined}
                className={`px-4 py-2 bg-surface-overlay hover:bg-border-strong disabled:bg-surface-overlay disabled:text-fg-disabled rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${creating ? " opacity-50" : ""}`}
              >
                {creating ? "记住中..." : "记住"}
              </button>
            </div>

            {shownListError ? (
              <LoadErrorNotice
                message={shownListError}
                busy={listFetching}
                onRetry={() => void refetchMemories()}
                testId="memories-load-error"
              />
            ) : Object.keys(grouped).length === 0 ? (
              <div className="text-center py-12">
                <Brain size={40} className="mx-auto mb-3 text-fg-disabled" />
                <p className="text-fg-tertiary text-sm">
                  我还没有记住任何事。开始一段对话，或者在上方告诉我关于你的事情。
                </p>
              </div>
            ) : (
              Object.entries(grouped).map(([category, items]) => {
                const meta = getCategoryMeta(category);
                const CategoryIcon = meta.icon;
                return (
                  <section key={category}>
                    <h3 className="text-sm font-semibold text-fg-secondary mb-3 flex items-center gap-1.5">
                      <CategoryIcon size={14} className="text-fg-tertiary" />
                      <span>{meta.title}</span>
                      <span className="text-fg-disabled">({items.length})</span>
                    </h3>
                    <ul className="space-y-2">
                      {items.map((m) => (
                        <MemoryListItem
                          key={m.id}
                          memory={m}
                          ratifying={ratifying.has(m.id)}
                          onRatify={handleRatify}
                          onReject={handleReject}
                          onEdit={handleEdit}
                          onDelete={setDeleteTarget}
                          chatting={chattingId === m.id}
                          onContinueChat={handleContinueChat}
                          onShowProvenance={setProvenanceTarget}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </>
        ) : (
          <div className="bg-surface-raised border border-border-subtle rounded-lg p-4">
            {graphError ? (
              <LoadErrorNotice
                message={graphError}
                busy={graphLoading}
                onRetry={() => setGraphAttempt((n) => n + 1)}
                testId="memories-graph-load-error"
              />
            ) : graphLoading || !graphData ? (
              <div className="flex items-center justify-center h-96 text-fg-tertiary">
                加载记忆图谱...
              </div>
            ) : graphData.nodes.length > 0 ? (
              <MemoryGraphView graph={graphData} />
            ) : (
              <div className="flex items-center justify-center h-96 text-fg-tertiary">
                暂无记忆数据可显示
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={!!deleteTarget}
        title="忘掉这条记忆？"
        description="确定让我忘掉这条记忆？此操作不可撤销。"
        confirmLabel={deleting ? "忘掉中..." : "忘掉"}
        variant="danger"
        confirmBusy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deletingRef.current) return;
          setDeleteTarget(null);
        }}
      />

      {rejectTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            if (rejectingRef.current) return;
            setRejectTarget(null);
          }}
        >
          <div
            ref={rejectPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={rejectTitleId}
            tabIndex={-1}
            className="bg-surface-raised border border-border-strong rounded-xl p-6 w-96 max-w-[90vw] space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={rejectTitleId} className="text-lg font-semibold text-fg-primary">
              拒绝这条记忆？
            </h3>
            <p className="text-xs text-fg-tertiary">可选填写原因，便于之后核对误报。</p>
            <input
              value={rejectReason}
              data-memory-dialog-field="reject"
              onChange={(e) => {
                rejectLive.current = e.target.value;
                setRejectReason(e.target.value);
              }}
              maxLength={200}
              className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
              placeholder="例如：记错了、过时了"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  if (rejectingRef.current) return;
                  setRejectTarget(null);
                }}
                className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-memory-dialog="reject"
                aria-busy={rejecting || undefined}
                onClick={() => void confirmReject()}
                className={`px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50${rejecting ? " opacity-50" : ""}`}
              >
                {rejecting ? "拒绝中..." : "拒绝"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => {
            if (editingRef.current) return;
            setEditTarget(null);
          }}
        >
          <div
            ref={editPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={editTitleId}
            tabIndex={-1}
            className="bg-surface-raised border border-border-strong rounded-xl p-6 w-96 max-w-[90vw] space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={editTitleId} className="text-lg font-semibold text-fg-primary">
              编辑记忆
            </h3>
            <p className="text-xs text-fg-tertiary">更新会保留旧版本——可在"来源"查看完整版本演进</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-fg-secondary mb-1 block">内容</label>
                <input
                  value={editContent}
                  data-memory-dialog-field="edit"
                  onChange={(e) => {
                    editLive.current = { ...editLive.current, content: e.target.value };
                    setEditContent(e.target.value);
                  }}
                  className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
                  placeholder="记忆内容"
                />
              </div>
              <div>
                <label className="text-xs text-fg-secondary mb-1 block">分类</label>
                <input
                  value={editCategory}
                  data-memory-dialog-field="edit"
                  onChange={(e) => {
                    editLive.current = { ...editLive.current, category: e.target.value };
                    setEditCategory(e.target.value);
                  }}
                  className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
                  placeholder="如 fact, preference, habit"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  if (editingRef.current) return;
                  setEditTarget(null);
                }}
                className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-memory-dialog="edit"
                disabled={!editContent.trim() && !editing}
                aria-busy={editing || undefined}
                onClick={() => void confirmEdit()}
                className={`px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50${editing ? " opacity-50" : ""}`}
              >
                {editing ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {provenanceTarget && (
        <MemoryProvenanceDialog
          target={provenanceTarget}
          onClose={() => setProvenanceTarget(null)}
        />
      )}
    </div>
  );
}
