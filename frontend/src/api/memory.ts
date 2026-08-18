/** Memory API — CRUD and search. */

import { API_BASE, request } from "./core";
import type { MemoryRow, MemoriesGrouped } from "./types";

export interface ListMemoriesGroupedOpts {
  claimStatus?: string;
  category?: string;
  order?: string;
  limit?: number;
}

export async function listMemoriesGrouped(
  opts: ListMemoriesGroupedOpts | string = {},
): Promise<MemoriesGrouped> {
  const normalized: ListMemoriesGroupedOpts =
    typeof opts === "string" ? { claimStatus: opts } : opts;
  const qs = new URLSearchParams();
  if (normalized.claimStatus) qs.set("claim_status", normalized.claimStatus);
  if (normalized.category) qs.set("category", normalized.category);
  if (normalized.order) qs.set("order", normalized.order);
  if (normalized.limit != null) qs.set("limit", String(normalized.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<MemoriesGrouped>(`${API_BASE}/memory/memories/grouped${suffix}`);
}

export async function countMemories(opts?: {
  claimStatus?: string;
  category?: string;
}): Promise<{ count: number }> {
  const qs = new URLSearchParams();
  if (opts?.claimStatus) qs.set("claim_status", opts.claimStatus);
  if (opts?.category) qs.set("category", opts.category);
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<{ count: number }>(`${API_BASE}/memory/memories/count${suffix}`);
}

export async function searchMemories(q: string, n = 5): Promise<MemoryRow[]> {
  return request<MemoryRow[]>(
    `${API_BASE}/memory/memories/search?q=${encodeURIComponent(q)}&n=${n}`,
  );
}

export async function createMemory(body: {
  content: string;
  category?: string;
}): Promise<{ id: string; status: string }> {
  return request(`${API_BASE}/memory/memories`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteMemory(memoryId: string): Promise<{ status: string }> {
  return request(`${API_BASE}/memory/memories/${memoryId}`, { method: "DELETE" });
}

export async function updateMemory(
  memoryId: string,
  body: { content: string; category?: string },
): Promise<{ status: string }> {
  return request(`${API_BASE}/memory/memories/${memoryId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function ratifyMemory(
  memoryId: string,
): Promise<{ status: string; claim_status: string }> {
  return request(`${API_BASE}/memory/memories/${memoryId}/ratify`, { method: "POST" });
}

export async function rejectMemory(
  memoryId: string,
  reason = "",
): Promise<{ status: string; claim_status: string }> {
  return request(`${API_BASE}/memory/memories/${memoryId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function bulkClaimAction(
  action: "ratify" | "reject",
  ids: string[],
  reason = "",
): Promise<{
  status: string;
  action: string;
  ok: number;
  skipped: Array<{ id: string; reason: string }>;
}> {
  return request(`${API_BASE}/memory/memories/claims/bulk`, {
    method: "POST",
    body: JSON.stringify({ action, ids, reason }),
  });
}

export interface ClaimConversionStats {
  days: number;
  proposed_open: number;
  ratified: number;
  rejected: number;
  decided: number;
  conversion_rate: number | null;
  false_positive_rate: number | null;
}

export async function getClaimConversionStats(days = 30): Promise<ClaimConversionStats> {
  return request<ClaimConversionStats>(`${API_BASE}/memory/memories/claims/stats?days=${days}`);
}

export interface MemoryProvenanceEvent {
  seq: number;
  type: string;
  ts: string;
  actor: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
}

export interface MemoryProvenance {
  memory_id: string;
  events: MemoryProvenanceEvent[];
}

export async function getMemoryProvenance(memoryId: string): Promise<MemoryProvenance> {
  return request<MemoryProvenance>(`${API_BASE}/memory/memories/${memoryId}/provenance`);
}

export interface MemoryGraphNode {
  id: string;
  content: string;
  category: string;
  confidence: number;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export async function getMemoryGraph(limit = 50): Promise<MemoryGraph> {
  return request<MemoryGraph>(`${API_BASE}/memory/graph?limit=${limit}`);
}
