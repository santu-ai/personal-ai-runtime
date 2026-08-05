/**
 * Work Items API — unified endpoint for tasks, actions, goals.
 */
import { API_BASE, request } from "./core";
import type { WorkItem, WorkItemType } from "./types";

export async function listWorkItems(workType?: WorkItemType, status?: string): Promise<WorkItem[]> {
  const params = new URLSearchParams();
  if (workType) params.set("work_type", workType);
  if (status) params.set("status", status);
  const qs = params.toString();
  const url = qs ? `${API_BASE}/work-items/?${qs}` : `${API_BASE}/work-items/`;
  return request<WorkItem[]>(url);
}

export async function getWorkItem(itemId: string, include?: string): Promise<WorkItem> {
  const qs = include ? `?include=${encodeURIComponent(include)}` : "";
  return request<WorkItem>(`${API_BASE}/work-items/${itemId}${qs}`);
}

export interface CreateWorkItemPayload {
  title: string;
  description?: string;
  work_type: WorkItemType;
  parent_work_id?: string;
  priority?: number;
  dependencies?: string[];
  executable_plan?: string;
  status?: string;
  progress?: number;
  importance?: number;
  urgency?: number;
  deadline?: string;
  last_activity_at?: string;
}

export async function createWorkItem(body: CreateWorkItemPayload): Promise<WorkItem> {
  return request<WorkItem>(`${API_BASE}/work-items/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface UpdateWorkItemPayload {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  progress?: number;
  importance?: number;
  urgency?: number;
  deadline?: string;
  last_activity_at?: string;
  parent_work_id?: string;
}

export async function updateWorkItem(
  itemId: string,
  body: UpdateWorkItemPayload,
): Promise<WorkItem> {
  return request<WorkItem>(`${API_BASE}/work-items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteWorkItem(itemId: string): Promise<void> {
  await request(`${API_BASE}/work-items/${itemId}`, { method: "DELETE" });
}

export async function decomposeWorkItem(itemId: string): Promise<{ steps: string[] }> {
  return request<{ steps: string[] }>(`${API_BASE}/work-items/${itemId}/decompose`, {
    method: "POST",
  });
}

/** List work items with work_type=goal. */
export async function listGoals(status?: string): Promise<WorkItem[]> {
  return listWorkItems("goal", status);
}

/** Fetch a goal with embedded actions + events. */
export async function getGoal(goalId: string): Promise<WorkItem> {
  return getWorkItem(goalId, "actions,events");
}

export async function createGoal(body: { title: string; description?: string }): Promise<WorkItem> {
  return createWorkItem({
    title: body.title,
    description: body.description,
    work_type: "goal",
    status: "active",
  });
}

export async function updateGoal(
  goalId: string,
  body: Partial<Pick<WorkItem, "title" | "description" | "status" | "progress">>,
): Promise<WorkItem> {
  return updateWorkItem(goalId, {
    ...body,
    description: body.description ?? undefined,
  });
}

export async function deleteGoal(goalId: string): Promise<void> {
  await deleteWorkItem(goalId);
}

export async function createGoalAction(goalId: string, title: string): Promise<WorkItem> {
  return createWorkItem({
    title,
    work_type: "action",
    parent_work_id: goalId,
    status: "pending",
  });
}

export async function updateGoalAction(
  _goalId: string,
  actionId: string,
  body: { status: string },
): Promise<WorkItem> {
  return updateWorkItem(actionId, body);
}

export async function decomposeGoal(goalId: string): Promise<{ steps: string[] }> {
  return decomposeWorkItem(goalId);
}
