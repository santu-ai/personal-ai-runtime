import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [bulkBusy, setBulkBusy] = useState(false);

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

  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [rejectTarget, setRejectTarget] = useState<MemoryRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const rejectingRef = useRef(false);
  const [editTarget, setEditTarget] = useState<MemoryRow | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false);
  const [provenanceTarget, setProvenanceTarget] = useState<MemoryRow | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphAttempt, setGraphAttempt] = useState(0);

  const invalidateMemories = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
    void queryClient.invalidateQueries({ queryKey: queryKeys.memoriesGrouped });
    void queryClient.invalidateQueries({ queryKey: ["memory", "claim-stats"] });
  };

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
    creatingRef.current = true;
    setCreating(true);
    try {
      await createMemory({ content, category: "fact" });
      setNewContent("");
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建记忆失败", "记忆");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deletingRef.current) return;
    const id = deleteTarget.id;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteMemory(id);
      setDeleteTarget(null);
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "删除记忆失败", "记忆");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const confirmEdit = async () => {
    if (!editTarget || !editContent.trim() || editingRef.current) return;
    const id = editTarget.id;
    const content = editContent.trim();
    const category = editCategory;
    editingRef.current = true;
    setEditing(true);
    try {
      await updateMemory(id, { content, category: category || undefined });
      setEditTarget(null);
      setEditContent("");
      setEditCategory("");
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新记忆失败", "记忆");
    } finally {
      editingRef.current = false;
      setEditing(false);
    }
  };

  const handleRatify = async (m: MemoryRow) => {
    try {
      await ratifyMemory(m.id);
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "确认记忆失败", "记忆");
    }
  };

  const handleReject = (m: MemoryRow) => {
    setRejectTarget(m);
    setRejectReason("");
  };

  const confirmReject = async () => {
    if (!rejectTarget || rejectingRef.current) return;
    const id = rejectTarget.id;
    const reason = rejectReason.trim();
    rejectingRef.current = true;
    setRejecting(true);
    try {
      await rejectMemory(id, reason);
      setRejectTarget(null);
      setRejectReason("");
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "拒绝记忆失败", "记忆");
    } finally {
      rejectingRef.current = false;
      setRejecting(false);
    }
  };

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

  const handleBulk = async (action: "ratify" | "reject") => {
    const ids = [...selectedIds];
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = await bulkClaimAction(action, ids);
      setSelectedIds(new Set());
      invalidateMemories();
      if (result.skipped.length > 0) {
        addError(`已处理 ${result.ok} 条，跳过 ${result.skipped.length} 条`, "记忆");
      }
    } catch (err) {
      addError(
        err instanceof ApiError
          ? err.message
          : action === "ratify"
            ? "批量确认失败"
            : "批量拒绝失败",
        "记忆",
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const handleEdit = (m: MemoryRow) => {
    setEditTarget(m);
    setEditContent(m.content);
    setEditCategory(m.category || "fact");
  };

  const handleContinueChat = (m: MemoryRow) => {
    quickChat({ title: "记忆讨论", prompt: `基于以下记忆继续讨论：\n${m.content}` });
  };

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
                  disabled={selectedIds.size === 0 || bulkBusy}
                  onClick={() => void handleBulk("ratify")}
                  className="px-3 py-1.5 text-sm rounded-lg bg-success/15 text-success hover:bg-success/25 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  批量确认（{selectedIds.size}）
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || bulkBusy}
                  onClick={() => void handleBulk("reject")}
                  className="px-3 py-1.5 text-sm rounded-lg bg-surface-overlay text-fg-secondary hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
                    onRatify={handleRatify}
                    onReject={handleReject}
                    onEdit={handleEdit}
                    onDelete={(row) => setDeleteTarget(row)}
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
                      onRatify={handleRatify}
                      onReject={handleReject}
                      onEdit={handleEdit}
                      onDelete={(row) => setDeleteTarget(row)}
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
                disabled={creating}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="告诉我一件关于你的事，我会记住..."
                className="flex-1 bg-surface-raised border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  void handleCreate();
                }}
              />
              <button
                onClick={() => void handleCreate()}
                disabled={creating || !newContent.trim()}
                className="px-4 py-2 bg-surface-overlay hover:bg-border-strong disabled:bg-surface-overlay disabled:text-fg-disabled rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
                          onRatify={handleRatify}
                          onReject={handleReject}
                          onEdit={handleEdit}
                          onDelete={setDeleteTarget}
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
              disabled={rejecting}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={200}
              className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
              placeholder="例如：记错了、过时了"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={rejecting}
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
                disabled={rejecting}
                aria-busy={rejecting || undefined}
                onClick={() => void confirmReject()}
                className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
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
                  disabled={editing}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
                  placeholder="记忆内容"
                />
              </div>
              <div>
                <label className="text-xs text-fg-secondary mb-1 block">分类</label>
                <input
                  value={editCategory}
                  disabled={editing}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring disabled:opacity-50"
                  placeholder="如 fact, preference, habit"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={editing}
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
                disabled={editing || !editContent.trim()}
                aria-busy={editing || undefined}
                onClick={() => void confirmEdit()}
                className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
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
