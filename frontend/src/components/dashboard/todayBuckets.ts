import type { InboxEmail, Notification, WorkItem } from "../../api/types";
import { toolLabel } from "../../utils/toolLabels";

/** Reminder types that cannot be represented as a three-column entity. */
export const REMINDER_ONLY_TYPES = new Set(["reminder", "url_monitor", "morning_brief_failed"]);

const DECIDE_EMAIL_CATEGORIES = new Set(["important", "actionable"]);
const DEADLINE_HORIZON_DAYS = 3;
const MAX_REMINDERS = 6;

export type TodayDecideItem =
  | { kind: "approval"; id: string; title: string; href: "/approvals" }
  | { kind: "memory"; id: "proposed"; title: string; href: "/memories?tab=review"; count: number }
  | { kind: "email"; id: string; title: string; href: "/inbox"; category: string };

export type TodayDoItem = {
  kind: "goal";
  id: string;
  title: string;
  href: string;
  reason: "deadline" | "stagnant";
  deadline?: string | null;
  progress: number;
};

export type TodayHandledItem =
  | { kind: "morning_brief"; id: string; title: string; href: "/dashboard" }
  | { kind: "inbox_digest"; id: string; title: string; href: "/inbox" }
  | { kind: "goal_event"; id: string; title: string; href: string }
  | { kind: "ignored_mail"; id: "ignored"; title: string; href: "/inbox"; count: number };

export interface TodayBuckets {
  decide: TodayDecideItem[];
  do: TodayDoItem[];
  handled: TodayHandledItem[];
  leftoverGoalCount: number;
  reminders: Notification[];
}

export interface TodayBucketInput {
  approvals?: Array<{ id: string; action?: string }>;
  proposedMemoryCount?: number;
  inboxEmails?: Array<Pick<InboxEmail, "id" | "subject" | "category">>;
  activeGoals?: Array<
    Pick<
      WorkItem,
      "id" | "title" | "status" | "progress" | "deadline" | "last_activity_at" | "created_at"
    >
  >;
  notifications?: Notification[];
  now?: Date;
}

export function notificationDedupeKey(n: Notification): string {
  if (n.related_id) return `related:${n.related_id}`;
  return `${n.type}:${n.title}`;
}

/** Prefer server rows over live WS duplicates; related_id first, else type:title. */
export function dedupeNotifications(items: Notification[]): Notification[] {
  const byKey = new Map<string, Notification>();
  for (const n of items) {
    const key = notificationDedupeKey(n);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, n);
      continue;
    }
    if (existing.source === "live" && n.source === "server") {
      byKey.set(key, n);
    }
  }
  return [...byKey.values()];
}

export function mergeLiveAndServerNotifications(
  server: Notification[],
  live: Notification[],
): Notification[] {
  const taggedServer = server.map((n) => ({ ...n, source: "server" as const }));
  const taggedLive = live
    .filter((n) => n.source !== "server")
    .map((n) => ({ ...n, source: "live" as const }));
  return dedupeNotifications([...taggedLive, ...taggedServer]);
}

/** 和审批页同一套中文工具名。空白不写成原始函数名。 */
function approvalTitle(action: string | undefined): string {
  const name = action?.trim() ?? "";
  if (!name) return "待审批操作";
  return toolLabel(name);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isDeadlineSoon(deadline: string | null | undefined, now: Date): boolean {
  if (!deadline) return false;
  const due = new Date(deadline);
  if (Number.isNaN(due.getTime())) return false;
  const horizon = startOfLocalDay(now);
  horizon.setDate(horizon.getDate() + DEADLINE_HORIZON_DAYS);
  horizon.setHours(23, 59, 59, 999);
  return due.getTime() <= horizon.getTime();
}

function isStagnantAt(
  lastActivity: string | null | undefined,
  createdAt: string | undefined,
  now: Date,
  days = 3,
): boolean {
  const referenceTime = lastActivity || createdAt;
  if (!referenceTime) return false;
  return now.getTime() - new Date(referenceTime).getTime() > days * 86400000;
}

function isTodayNotification(n: Notification, now: Date): boolean {
  const ts = n.created_at ? new Date(n.created_at) : null;
  if (!ts || Number.isNaN(ts.getTime())) return true;
  return ts.toDateString() === now.toDateString();
}

function isGoalProgressNotification(type: string): boolean {
  return (
    type.includes("goal") &&
    (type.includes("progress") || type.includes("complete") || type.includes("status"))
  );
}

export function buildTodayBuckets(input: TodayBucketInput): TodayBuckets {
  const now = input.now ?? new Date();
  const approvals = input.approvals ?? [];
  const inbox = input.inboxEmails ?? [];
  const goals = (input.activeGoals ?? []).filter((g) => g.status === "active");
  const notifications = dedupeNotifications(input.notifications ?? []);
  const proposedCount = input.proposedMemoryCount ?? 0;

  const decide: TodayDecideItem[] = approvals.map((a) => ({
    kind: "approval" as const,
    id: a.id,
    title: approvalTitle(a.action),
    href: "/approvals" as const,
  }));
  if (proposedCount > 0) {
    decide.push({
      kind: "memory",
      id: "proposed",
      title: `${proposedCount} 条记忆待确认`,
      href: "/memories?tab=review",
      count: proposedCount,
    });
  }
  for (const email of inbox) {
    if (DECIDE_EMAIL_CATEGORIES.has(email.category)) {
      decide.push({
        kind: "email",
        id: email.id,
        title: email.subject || "(无主题)",
        href: "/inbox",
        category: email.category,
      });
    }
  }

  const doItems: TodayDoItem[] = [];
  let leftoverGoalCount = 0;
  for (const goal of goals) {
    const deadlineSoon = isDeadlineSoon(goal.deadline, now);
    const stagnant = isStagnantAt(goal.last_activity_at, goal.created_at, now);
    if (deadlineSoon || stagnant) {
      doItems.push({
        kind: "goal",
        id: goal.id,
        title: goal.title,
        href: `/goals/${goal.id}`,
        reason: deadlineSoon ? "deadline" : "stagnant",
        deadline: goal.deadline,
        progress: goal.progress,
      });
    } else {
      leftoverGoalCount += 1;
    }
  }

  const handled: TodayHandledItem[] = [];
  for (const n of notifications) {
    if (n.type === "morning_brief" && isTodayNotification(n, now)) {
      handled.push({
        kind: "morning_brief",
        id: n.id,
        title: n.title,
        href: "/dashboard",
      });
    } else if (n.type === "inbox_digest" || n.type.includes("inbox_digest")) {
      handled.push({
        kind: "inbox_digest",
        id: n.id,
        title: n.title,
        href: "/inbox",
      });
    } else if (isGoalProgressNotification(n.type)) {
      handled.push({
        kind: "goal_event",
        id: n.id,
        title: n.title,
        href: n.related_id ? `/goals/${n.related_id}` : "/goals",
      });
    }
  }
  const ignoredCount = inbox.filter((e) => e.category === "ignorable").length;
  if (ignoredCount > 0) {
    handled.push({
      kind: "ignored_mail",
      id: "ignored",
      title: `${ignoredCount} 封可忽略邮件`,
      href: "/inbox",
      count: ignoredCount,
    });
  }

  const reminders = notifications
    .filter((n) => REMINDER_ONLY_TYPES.has(n.type))
    .slice(0, MAX_REMINDERS);

  return { decide, do: doItems, handled, leftoverGoalCount, reminders };
}
