/** System API — health, LLM providers, MCP status, export/import, dashboard. */

import { API_BASE, ApiError, authHeaders, request } from "./core";
import type {
  HealthResponse,
  SystemInfo,
  LlmProvidersResponse,
  DashboardData,
  McpStatusResponse,
} from "./types";

export async function getSystemHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(`${API_BASE}/system/health`);
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  return request<SystemInfo>(`${API_BASE}/system/info`);
}

export async function getLlmProviders(): Promise<LlmProvidersResponse> {
  return request<LlmProvidersResponse>(`${API_BASE}/system/llm-providers`);
}

export interface LocalModels {
  reachable: boolean;
  installed: string[];
  recommended: string;
  recommended_installed: boolean;
  selected: string | null;
  message: string;
}

export async function getLocalModels(): Promise<LocalModels> {
  return request<LocalModels>(`${API_BASE}/system/local-models`);
}

/** Stream Ollama pull progress. `onStatus` receives the latest Chinese line. */
export async function pullRecommendedModel(
  name: string,
  onStatus: (status: string) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}/system/local-models/pull`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok || !res.body) {
    let message = "拉取失败";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      /* keep the fallback */
    }
    throw new ApiError(message, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let failed = false;
  let last = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    pending += decoder.decode(chunk.value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let row: { status?: string; ok?: boolean };
      try {
        row = JSON.parse(line) as { status?: string; ok?: boolean };
      } catch {
        continue;
      }
      if (row.status) {
        last = row.status;
        onStatus(row.status);
      }
      if (row.ok === false) failed = true;
    }
  }
  if (failed) {
    throw new ApiError(last || "拉取失败", 502);
  }
}

export async function getMcpStatus(): Promise<McpStatusResponse> {
  return request<McpStatusResponse>(`${API_BASE}/system/mcp-status`);
}

export async function getDashboard(): Promise<DashboardData> {
  return request<DashboardData>(`${API_BASE}/dashboard`);
}

export interface CountSignal {
  current: number;
  previous: number;
  delta: number;
}

export interface RateSignal {
  current: number | null;
  previous: number | null;
  delta: number | null;
}

/** Last N days against the previous N days, rebuilt from existing events. */
export interface PeriodComparison {
  days: number;
  current: { start: string; end: string };
  previous: { start: string; end: string };
  signals: {
    goals_completed: CountSignal;
    tasks_completed: CountSignal;
    work_completed_untyped: CountSignal;
    inbox_recorded: CountSignal;
    adoption_decided: CountSignal;
    adoption_rate: RateSignal;
  };
  capped: boolean;
}

export async function getPeriodComparison(days = 7): Promise<PeriodComparison> {
  return request<PeriodComparison>(`${API_BASE}/dashboard/periods?days=${days}`);
}

/**
 * Stream plaintext snapshot to a file download without JSON.parse + re-stringify.
 * Response body is already valid snapshot JSON from the server.
 */
export async function downloadDiagnostics(filename?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/system/diagnostics`, {
    headers: authHeaders(),
  });
  if (res.status === 401) {
    throw new ApiError("认证失败，请检查 AUTH_TOKEN 与 VITE_AUTH_TOKEN 是否一致", 401);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.detail || body.message || "";
    } catch {
      // not JSON
    }
    throw new ApiError(detail || `请求失败 (HTTP ${res.status})`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const day = new Date().toISOString().slice(0, 10);
  a.download = filename ?? `diagnostics-${day}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadExport(filename?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/system/export`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ confirm: "EXPORT_ALL_DATA" }),
  });

  if (res.status === 401) {
    throw new ApiError("认证失败，请检查 AUTH_TOKEN 与 VITE_AUTH_TOKEN 是否一致", 401);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.detail || body.message || "";
    } catch {
      // not JSON
    }
    throw new ApiError(detail || `请求失败 (HTTP ${res.status})`, res.status);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `personal-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importData(
  data: Record<string, unknown>,
  readOnly = false,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { data, read_only: readOnly };
  if (!readOnly) {
    body.confirm = "DESTROY_AND_IMPORT";
  }
  return request(`${API_BASE}/system/import`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function exportEncryptedData(
  password: string,
): Promise<{ format: string; data: string }> {
  return request(`${API_BASE}/system/export/encrypted`, {
    method: "POST",
    body: JSON.stringify({ confirm: "EXPORT_ALL_DATA", password }),
  });
}

export async function importEncryptedData(
  data: string,
  password: string,
): Promise<Record<string, unknown>> {
  return request(`${API_BASE}/system/import/encrypted`, {
    method: "POST",
    body: JSON.stringify({ confirm: "DESTROY_AND_IMPORT", data, password }),
  });
}

export async function destroyAllData(): Promise<Record<string, unknown>> {
  return request(`${API_BASE}/system/data`, {
    method: "DELETE",
    body: JSON.stringify({ confirm: "DESTROY_ALL_DATA" }),
  });
}
