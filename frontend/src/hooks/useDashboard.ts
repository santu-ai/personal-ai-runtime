import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getCostSummary,
  getCostByModel,
  getToolSummary,
  getMemoryStats,
  getHealth,
  listNotifications,
  getDashboard,
  type CostSummary,
  type ModelCostItem,
  type ToolSummaryItem,
  type MemoryStats,
  type HealthSnapshot,
  type Notification,
  type DashboardData,
} from "../api/client";
import { useErrorStore } from "../stores/errorStore";
import { queryKeys } from "./useWsInvalidationBridge";

/**
 * Dashboard data — decomposed into independent TanStack Query hooks
 * so each subset is independently cached and invalidated by the
 * WebSocket invalidation bridge (useWsInvalidationBridge).
 *
 * Soft failures (telemetry / notifications) toast but do not blank the page.
 * Full-page error only when we have no useful data after load settles.
 * 重试会把这次失败清掉并把 isLoading 再置上；原因留着，避免整页闪回「加载中...」。
 */

const DASHBOARD_FATAL_FALLBACK = "无法连接到后端服务，请确认后端已启动";

/** 有原文用原文。空白或不是 Error 时用整页自己的说法，避免把读失败写成空的一天。 */
function dashboardFatalMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return DASHBOARD_FATAL_FALLBACK;
}

const DASHBOARD_STALE_MS = 60_000; // 1-minute refetch interval

export function useDashboard() {
  const addError = useErrorStore((s) => s.addError);

  const cost = useQuery<CostSummary>({
    queryKey: ["telemetry", "costSummary"],
    queryFn: () => getCostSummary(7),
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const costByModel = useQuery<ModelCostItem[]>({
    queryKey: ["telemetry", "costByModel"],
    queryFn: () => getCostByModel(7),
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const tools = useQuery<ToolSummaryItem[]>({
    queryKey: ["telemetry", "toolSummary"],
    queryFn: () => getToolSummary(7),
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const memory = useQuery<MemoryStats>({
    queryKey: ["telemetry", "memoryStats"],
    queryFn: () => getMemoryStats(),
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const health = useQuery<HealthSnapshot>({
    queryKey: ["telemetry", "health"],
    queryFn: () => getHealth(),
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const notifications = useQuery<Notification[]>({
    queryKey: ["notifications", "dashboard"],
    queryFn: () => listNotifications(10),
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const dashboard = useQuery<DashboardData>({
    queryKey: queryKeys.dashboard,
    queryFn: getDashboard,
    refetchInterval: DASHBOARD_STALE_MS,
    staleTime: 30_000,
    retry: 1,
  });

  const queries = [cost, costByModel, tools, memory, health, notifications, dashboard];
  const anyLoading = queries.some((q) => q.isLoading);
  const hasAnyData = queries.some((q) => q.data !== undefined);
  const errors = queries.map((q) => q.error).filter(Boolean);
  const fetchingWithoutData = !hasAnyData && queries.some((q) => q.isFetching);
  // 还在首轮加载时不把先失败的一块写成整页失败。全部停下且没有数据，才是这次读失败。
  const settledFatal =
    !hasAnyData && !anyLoading && errors.length > 0 ? dashboardFatalMessage(errors[0]) : null;
  const [heldFatal, setHeldFatal] = useState<string | null>(null);

  useEffect(() => {
    if (hasAnyData) {
      setHeldFatal(null);
      return;
    }
    if (settledFatal) setHeldFatal(settledFatal);
    else if (!fetchingWithoutData) setHeldFatal(null);
  }, [hasAnyData, settledFatal, fetchingWithoutData]);

  const shownFatal = hasAnyData ? null : (settledFatal ?? (fetchingWithoutData ? heldFatal : null));
  // 首轮转圈只到至少一块数据到来，或全部停下。已经写出的失败在重试期间留着。
  const loading = anyLoading && !hasAnyData && !shownFatal;
  const errorBusy = Boolean(shownFatal) && fetchingWithoutData;

  const partialErrorMsg =
    hasAnyData && errors.length > 0
      ? errors[0] instanceof Error
        ? errors[0].message
        : "部分仪表盘数据加载失败"
      : null;
  const softErrorMsg = shownFatal ?? partialErrorMsg;

  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!softErrorMsg) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === softErrorMsg) return;
    lastErrorRef.current = softErrorMsg;
    addError(softErrorMsg, "仪表盘");
  }, [softErrorMsg, addError]);

  const refresh = useCallback(() => {
    cost.refetch();
    costByModel.refetch();
    tools.refetch();
    memory.refetch();
    health.refetch();
    notifications.refetch();
    dashboard.refetch();
  }, [cost, costByModel, tools, memory, health, notifications, dashboard]);

  const retryNotifications = useCallback(() => {
    void notifications.refetch();
  }, [notifications]);

  return {
    cost: cost.data ?? null,
    costByModel: costByModel.data ?? [],
    tools: tools.data ?? [],
    memory: memory.data ?? null,
    health: health.data ?? null,
    notifications: notifications.data ?? [],
    notificationsLoaded: notifications.data !== undefined,
    notificationsError: notifications.error,
    notificationsFetching: notifications.isFetching,
    notificationsPending: notifications.isPending && notifications.data === undefined,
    dashboard: dashboard.data ?? null,
    loading,
    error: shownFatal ?? "",
    errorBusy,
    refresh,
    retryNotifications,
  };
}
