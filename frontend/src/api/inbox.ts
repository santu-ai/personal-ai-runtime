/** Inbox API — email listing, digest, polling. */

import { API_BASE, request } from "./core";
import type { InboxEmail } from "./types";

export async function listInboxEmails(
  category?: string,
  status = "pending",
  limit?: number,
): Promise<InboxEmail[]> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (status) params.set("status", status);
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  const url = qs ? `${API_BASE}/inbox/?${qs}` : `${API_BASE}/inbox/`;
  return request<InboxEmail[]>(url);
}

export async function updateInboxEmailStatus(
  emailId: string,
  status: "pending" | "read" | "handled",
): Promise<{ id: string; status: string }> {
  return request(`${API_BASE}/inbox/${encodeURIComponent(emailId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function getInboxDigest(): Promise<{
  title?: string;
  content?: string;
  message?: string;
}> {
  return request(`${API_BASE}/inbox/digest`);
}

export async function triggerInboxPoll(): Promise<Record<string, unknown>> {
  return request(`${API_BASE}/inbox/poll`, { method: "POST" });
}

export type InboxPollErrorKind = "credentials" | "json" | "imap" | "classification" | "other";

export interface InboxSyncMetrics {
  days: number;
  poll_count: number;
  requested_count: number;
  error_count: number;
  errors_by_kind: Record<string, number>;
  new_count: number;
  duplicate_count: number;
  synced_read: number;
  classification_fallback: number;
  rapid_repeat_polls: number;
}

export interface InboxSyncStatus {
  status: "ok" | "error" | "idle" | "success";
  error: string | null;
  error_kind: InboxPollErrorKind | null;
  new_count: number;
  synced_read: number;
  duplicate_count: number;
  classification_fallback: number;
  uid_validity: string | null;
  next_uid: number | null;
  cursor_reset: boolean;
  synced_at: string | null;
  event_id: string | null;
  metrics: InboxSyncMetrics;
}

export async function getInboxSyncStatus(): Promise<InboxSyncStatus> {
  return request(`${API_BASE}/inbox/sync-status`);
}

export async function getInboxEmailDetail(emailId: string): Promise<InboxEmail> {
  return request<InboxEmail>(`${API_BASE}/inbox/${encodeURIComponent(emailId)}`);
}

export async function getInboxEmailSummary(
  emailId: string,
): Promise<{ email_id: string; subject: string; sender: string; summary: string }> {
  return request(`${API_BASE}/inbox/${encodeURIComponent(emailId)}/summary`);
}
