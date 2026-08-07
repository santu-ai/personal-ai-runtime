/**
 * useMemoriesQuery — TanStack Query-backed memories fetcher.
 *
 * Replaces the ad-hoc useState + setTimeout pattern in ChatView. Cache
 * invalidation is driven by WS `memory_changed` events (see
 * useWsInvalidationBridge), so consumers never need to poll.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  countMemories,
  listMemoriesGrouped,
  type ListMemoriesGroupedOpts,
  type MemoryRow,
} from "../api/client";
import { queryKeys } from "./useWsInvalidationBridge";

export interface MemoriesGroupedResult {
  /** Page of memories (may be truncated by API limit). */
  memories: MemoryRow[];
  /** Untruncated match count from the server. */
  total: number;
  /** Convenience slice of the 3 most recent for welcome-screen display. */
  recent: MemoryRow[];
}

export function useMemoriesGroupedQuery(opts?: ListMemoriesGroupedOpts | string) {
  const normalized: ListMemoriesGroupedOpts =
    typeof opts === "string" ? { claimStatus: opts } : (opts ?? {});

  return useQuery<MemoriesGroupedResult>({
    queryKey: [...queryKeys.memoriesGrouped, normalized] as const,
    queryFn: async () => {
      const data = await listMemoriesGrouped(normalized);
      const memories = (data.memories ?? []).slice().sort((a, b) => {
        const at = new Date(a.created_at ?? 0).getTime();
        const bt = new Date(b.created_at ?? 0).getTime();
        // Preserve server order when an explicit order was requested;
        // default UX still prefers newest-first when unspecified.
        if (normalized.order === "created_at_asc") return at - bt;
        return bt - at;
      });
      const total = data.total ?? memories.length;
      return { memories, total, recent: memories.slice(0, 3) };
    },
    // Keep prior page while filters/order change so review triage does not blank.
    placeholderData: keepPreviousData,
    // Memories change via background extraction; keep reasonably fresh even
    // if a WS event is missed.
    staleTime: 10_000,
  });
}

/** Lightweight badge count — avoids loading up to 100 rows for Sidebar. */
export function useProposedMemoryCountQuery() {
  return useQuery({
    queryKey: [...queryKeys.memoriesGrouped, "count", "proposed"] as const,
    queryFn: async () => {
      const data = await countMemories({ claimStatus: "proposed" });
      return data.count;
    },
    staleTime: 10_000,
  });
}
