import { useSyncExternalStore } from "react";

/** Latest brief compile stage. Transport only; not a delivery. */
export type BriefProgress = {
  workId: string;
  stage: string;
  sourcesRead: number;
  sourcesTotal: number;
  recordedAt: number;
};

let current: BriefProgress | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function noteBriefProgress(raw: unknown, recordedAt = Date.now()): void {
  if (!raw || typeof raw !== "object") return;
  const evt = raw as {
    type?: string;
    work_id?: string;
    stage?: string;
    sources_read?: number;
    sources_total?: number;
  };
  if (evt.type !== "brief_progress") return;
  const workId = String(evt.work_id || "").trim();
  if (!workId) return;
  current = {
    workId,
    stage: String(evt.stage || "").trim(),
    sourcesRead: Number(evt.sources_read || 0),
    sourcesTotal: Number(evt.sources_total || 0),
    recordedAt,
  };
  emit();
}

export function resetBriefProgress(): void {
  current = null;
  emit();
}

export function getBriefProgress(): BriefProgress | null {
  return current;
}

export function subscribeBriefProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBriefProgress(): BriefProgress | null {
  return useSyncExternalStore(subscribeBriefProgress, getBriefProgress, getBriefProgress);
}
