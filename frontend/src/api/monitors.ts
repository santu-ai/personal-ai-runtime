/** Monitors API — inbox filters + URL diff monitors. */

import { API_BASE, request } from "./core";

export interface InboxFilter {
  id: string;
  enabled: boolean;
  name: string;
  sender_contains: string;
  subject_contains: string;
  created_at?: string;
}

export interface UrlMonitor {
  id: string;
  enabled: boolean;
  name: string;
  url: string;
  check_interval_minutes: number;
  created_at?: string;
  last_hash?: string | null;
  last_title?: string | null;
  last_checked_at?: string | null;
  last_error?: string | null;
}

export async function listInboxFilters(): Promise<InboxFilter[]> {
  const data = await request<{ filters: InboxFilter[] }>(`${API_BASE}/monitors/inbox-filters`);
  return data.filters ?? [];
}

export async function createInboxFilter(body: {
  name: string;
  sender_contains?: string;
  subject_contains?: string;
  enabled?: boolean;
}): Promise<InboxFilter> {
  return request<InboxFilter>(`${API_BASE}/monitors/inbox-filters`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateInboxFilter(
  filterId: string,
  body: Partial<Pick<InboxFilter, "name" | "sender_contains" | "subject_contains" | "enabled">>,
): Promise<InboxFilter> {
  return request<InboxFilter>(`${API_BASE}/monitors/inbox-filters/${filterId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteInboxFilter(filterId: string): Promise<void> {
  await request(`${API_BASE}/monitors/inbox-filters/${filterId}`, { method: "DELETE" });
}

export async function listUrlMonitors(): Promise<UrlMonitor[]> {
  const data = await request<{ monitors: UrlMonitor[] }>(`${API_BASE}/monitors/url-monitors`);
  return data.monitors ?? [];
}

export async function createUrlMonitor(body: {
  name: string;
  url: string;
  enabled?: boolean;
  check_interval_minutes?: number;
}): Promise<UrlMonitor> {
  return request<UrlMonitor>(`${API_BASE}/monitors/url-monitors`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateUrlMonitor(
  monitorId: string,
  body: Partial<Pick<UrlMonitor, "name" | "url" | "enabled" | "check_interval_minutes">>,
): Promise<UrlMonitor> {
  return request<UrlMonitor>(`${API_BASE}/monitors/url-monitors/${monitorId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteUrlMonitor(monitorId: string): Promise<void> {
  await request(`${API_BASE}/monitors/url-monitors/${monitorId}`, { method: "DELETE" });
}

export async function checkUrlMonitors(force = true): Promise<{ notified: number }> {
  return request<{ notified: number; force: boolean }>(
    `${API_BASE}/monitors/url-monitors/check?force=${force ? "true" : "false"}`,
    { method: "POST" },
  );
}
