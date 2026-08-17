import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  createMemory,
  deleteMemory,
  updateMemory,
  ratifyMemory,
  rejectMemory,
  bulkClaimAction,
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

  const { data, isLoading: loading, error: loadError } = useMemoriesGroupedQuery();
  const {
    data: proposedData,
    isLoading: proposedLoading,
    isFetching: proposedFetching,
  } = useMemoriesGroupedQuery({
    claimStatus: "proposed",
    category: reviewCategory || undefined,
    order: reviewOrder,
    limit: 100,
  });
  const { data: proposedTotal = 0 } = useProposedMemoryCountQuery();
  const memories = data?.memories ?? [];
  const proposedMemories = proposedData?.memories ?? [];
  const filteredTotal = proposedData?.total ?? proposedMemories.length;
  // First visit only — filter changes keep placeholderData so the page stays up.
  const reviewInitialLoading = viewMode === "review" && proposedLoading && !proposedData;
  const addError = useErrorStore((s) => s.addError);
  const quickChat = useQuickChat();

  const [newContent, setNewContent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MemoryRow | null>(null);
  const [editTarget, setEditTarget] = useState<MemoryRow | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [provenanceTarget, setProvenanceTarget] = useState<MemoryRow | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  const invalidateMemories = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
    void queryClient.invalidateQueries({ queryKey: queryKeys.memoriesGrouped });
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
      const msg = loadError instanceof ApiError ? loadError.message : "加载记忆失败";
      addError(msg, "记忆");
    }
  }, [loadError, addError]);

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    try {
      await createMemory({ content: newContent.trim(), category: "fact" });
      setNewContent("");
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "创建记忆失败", "记忆");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await deleteMemory(id);
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "删除记忆失败", "记忆");
    }
  };

  const confirmEdit = async () => {
    if (!editTarget || !editContent.trim()) return;
    const id = editTarget.id;
    setEditTarget(null);
    try {
      await updateMemory(id, { content: editContent.trim(), category: editCategory || undefined });
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "更新记忆失败", "记忆");
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

  const handleReject = async (m: MemoryRow) => {
    try {
      await rejectMemory(m.id);
      invalidateMemories();
    } catch (err) {
      addError(err instanceof ApiError ? err.message : "拒绝记忆失败", "记忆");
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
        const data = await getMemoryGraph(30);
        if (!cancelled) setGraphData(data);
      } catch (err) {
        if (!cancelled) {
          addError(err instanceof ApiError ? err.message : "加载记忆图谱失败", "记忆");
        }
      } finally {
        if (!cancelled) setGraphLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, graphData, addError]);

  if (loading || reviewInitialLoading) {
    return <div className="flex-1 flex items-center justify-center text-fg-tertiary">加载中…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2 text-fg-primary">AI 对你的理解</h2>
            <p className="text-sm text-fg-tertiary">
              这些是我从我们的对话中记住的。{memories.length > 0 && `共 ${memories.length} 条。`}
              {proposedTotal > 0 && (
                <span className="text-warning"> 其中 {proposedTotal} 条待你确认。</span>
              )}
              每一条都让我更好地帮助你。
            </p>
          </div>
          <div className="flex gap-1 bg-surface-overlay rounded-lg p-1">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                viewMode === "list"
                  ? "bg-border-strong text-white"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <List size={14} />
              列表
            </button>
            <button
              onClick={() => setViewMode("review")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                viewMode === "review"
                  ? "bg-border-strong text-white"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <ClipboardCheck size={14} />
              待确认
              {proposedTotal > 0 && (
                <span className="ml-1 text-[10px] min-w-[1.1rem] h-4 px-1 rounded-full bg-warning/20 text-warning flex items-center justify-center">
                  {proposedTotal > 99 ? "99+" : proposedTotal}
                </span>
              )}
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                viewMode === "graph"
                  ? "bg-border-strong text-white"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <Network size={14} />
              图谱
            </button>
            <button
              onClick={() => setViewMode("portrait")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                viewMode === "portrait"
                  ? "bg-border-strong text-white"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              <User size={14} />
              画像
            </button>
          </div>
        </div>

        {viewMode === "portrait" ? (
          <PortraitPanel compact />
        ) : viewMode === "review" ? (
          <>
            <p className="text-sm text-fg-secondary">
              以下记忆由对话推断而来，确认后才会进入聊天上下文；拒绝则不会再被召回。
            </p>

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

            {proposedMemories.length === 0 ? (
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
          </>
        ) : viewMode === "list" ? (
          <>
            <div className="flex gap-2">
              <input
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="告诉我一件关于你的事，我会记住..."
                className="flex-1 bg-surface-raised border border-border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary outline-none focus:border-focus-ring"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={!newContent.trim()}
                className="px-4 py-2 bg-surface-overlay hover:bg-border-strong disabled:bg-surface-overlay disabled:text-fg-disabled rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                记住
              </button>
            </div>

            {Object.keys(grouped).length === 0 ? (
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
            {graphLoading ? (
              <div className="flex items-center justify-center h-96 text-fg-tertiary">
                加载记忆图谱...
              </div>
            ) : graphData && graphData.nodes.length > 0 ? (
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
        confirmLabel="忘掉"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {editTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setEditTarget(null)}
        >
          <div
            className="bg-surface-raised border border-border-strong rounded-xl p-6 w-96 max-w-[90vw] space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-fg-primary">编辑记忆</h3>
            <p className="text-xs text-fg-tertiary">更新会保留旧版本——可在"来源"查看完整版本演进</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-fg-secondary mb-1 block">内容</label>
                <input
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring"
                  placeholder="记忆内容"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-fg-secondary mb-1 block">分类</label>
                <input
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full bg-surface-overlay rounded-lg px-3 py-2 text-sm text-fg-primary border border-border-strong placeholder:text-fg-tertiary outline-none focus:border-focus-ring"
                  placeholder="如 fact, preference, habit"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditTarget(null)}
                className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                取消
              </button>
              <button
                onClick={confirmEdit}
                className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                保存
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
