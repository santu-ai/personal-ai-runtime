/**
 * Background + task work-item queries for the Tasks panel.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listWorkItems,
  getWorkItem,
  type WorkItem,
} from "../api/client";
import { queryKeys } from "./useWsInvalidationBridge";

async function listTasksAndBackground(): Promise<WorkItem[]> {
  const [background, tasks] = await Promise.all([
    listWorkItems("background"),
    listWorkItems("task"),
  ]);
  return [...background, ...tasks].sort((a, b) =>
    (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || ""),
  );
}

export function useTasksQuery() {
  return useQuery<WorkItem[]>({
    queryKey: queryKeys.tasks,
    queryFn: listTasksAndBackground,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useTaskDetailQuery(itemId: string | undefined) {
  return useQuery<WorkItem>({
    queryKey: [...queryKeys.tasks, itemId, "detail"] as const,
    queryFn: () => getWorkItem(itemId!, "execution,events"),
    enabled: Boolean(itemId),
    staleTime: 5_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "running" || status === "waiting_approval") return 5_000;
      return false;
    },
    retry: (count, err) => {
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 404
      ) {
        return false;
      }
      return count < 1;
    },
  });
}

export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
  };
}
