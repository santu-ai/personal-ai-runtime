import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, ratifyMemory, rejectMemory } from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { useMemoriesGroupedQuery, useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";

const PREVIEW_LIMIT = 3;

interface Props {
  className?: string;
}

/**
 * Inline ratify/reject for proposed claims.
 *
 * Proposed memories are excluded from chat retrieval until ratified.
 * ChatHome previously had no path at all; ChatView only linked out to
 * /memories. Reuses existing memory APIs — no new fragment.
 */
export default function ProposedMemoryBanner({ className = "" }: Props) {
  const { data: proposedCount = 0 } = useProposedMemoryCountQuery();
  const { data } = useMemoriesGroupedQuery({
    claimStatus: "proposed",
    limit: PREVIEW_LIMIT,
    order: "created_at_desc",
  });
  const queryClient = useQueryClient();
  const addError = useErrorStore((s) => s.addError);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (proposedCount <= 0) return null;

  const items = (data?.memories ?? []).slice(0, PREVIEW_LIMIT);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.memories });
    void queryClient.invalidateQueries({ queryKey: queryKeys.memoriesGrouped });
  };

  const act = async (id: string, action: "ratify" | "reject") => {
    setBusyId(id);
    try {
      if (action === "ratify") await ratifyMemory(id);
      else await rejectMemory(id);
      invalidate();
    } catch (err) {
      addError(
        err instanceof ApiError
          ? err.message
          : action === "ratify"
            ? "确认记忆失败"
            : "拒绝记忆失败",
        "记忆",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className={`px-4 py-2 bg-insight/10 border-b border-insight/30 text-xs text-insight ${className}`.trim()}
    >
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0">{proposedCount} 条记忆待确认后才会进入对话</p>
        <Link
          to="/memories?tab=review"
          className="shrink-0 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          查看全部
        </Link>
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-fg-primary">
              <span className="flex-1 min-w-0 truncate" title={m.content}>
                {m.content}
                {typeof m.confidence === "number" && (
                  <span className="text-fg-tertiary"> · {Math.round(m.confidence * 100)}%</span>
                )}
              </span>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={() => void act(m.id, "ratify")}
                className="shrink-0 px-2 py-0.5 rounded bg-insight/20 hover:bg-insight/30 text-insight disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                确认
              </button>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={() => void act(m.id, "reject")}
                className="shrink-0 px-2 py-0.5 rounded hover:bg-surface-overlay text-fg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                拒绝
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
