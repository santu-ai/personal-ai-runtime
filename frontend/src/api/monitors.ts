/** Monitors API — inbox filter CRUD. */

import { API_BASE, request } from "./core";

export interface InboxFilter {
  id: string;
  enabled: boolean;
  name: string;
  sender_contains: string;
  subject_contains: string;
  created_at?: string;
}

export async function listInboxFilters(): Promise<InboxFilter[]> {
  const data = await request<{ filters: InboxFilter[] }>(
    `${API_BASE}/monitors/inbox-filters`,
  );
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
