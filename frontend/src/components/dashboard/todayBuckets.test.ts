import { describe, expect, it } from "vitest";
import {
  buildTodayBuckets,
  dedupeNotifications,
  mergeLiveAndServerNotifications,
  REMINDER_ONLY_TYPES,
} from "./todayBuckets";
import type { Notification, WorkItem } from "../../api/types";

const now = new Date("2026-08-31T10:00:00");

function goal(partial: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    description: null,
    work_type: "goal",
    parent_work_id: null,
    status: "active",
    priority: 0,
    dependencies_json: null,
    executable_plan: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    completed_at: null,
    progress: 0.2,
    importance: 0.5,
    urgency: 0.5,
    deadline: null,
    last_activity_at: "2026-08-30T00:00:00Z",
    ...partial,
  };
}

function notif(
  partial: Partial<Notification> & { id: string; type: string; title: string },
): Notification {
  return {
    content: "",
    created_at: "2026-08-31T08:00:00Z",
    ...partial,
  };
}

describe("buildTodayBuckets", () => {
  it("puts approvals, proposed memories and important/actionable mail in decide", () => {
    const buckets = buildTodayBuckets({
      now,
      approvals: [{ id: "ap-1", action: "write_file" }],
      proposedMemoryCount: 2,
      inboxEmails: [
        { id: "e-imp", subject: "合同", category: "important" },
        { id: "e-act", subject: "跟进", category: "actionable" },
        { id: "e-ign", subject: "促销", category: "ignorable" },
      ],
    });
    expect(buckets.decide.map((i) => i.kind)).toEqual(["approval", "memory", "email", "email"]);
    expect(buckets.decide[0]).toMatchObject({ kind: "approval", title: "写入文件" });
    expect(buckets.handled.some((i) => i.kind === "ignored_mail" && i.count === 1)).toBe(true);
  });

  it("keeps a blank approval titled 待审批操作", () => {
    const buckets = buildTodayBuckets({
      now,
      approvals: [{ id: "ap-blank", action: "  " }, { id: "ap-missing" }],
    });
    expect(buckets.decide.map((i) => i.title)).toEqual(["待审批操作", "待审批操作"]);
  });

  it("keeps deadline and stagnant goals in do, leftover as count", () => {
    const buckets = buildTodayBuckets({
      now,
      activeGoals: [
        goal({ id: "g-due", title: "交税", deadline: "2026-09-02T00:00:00Z" }),
        goal({
          id: "g-stale",
          title: "学 Rust",
          last_activity_at: "2026-08-20T00:00:00Z",
        }),
        goal({ id: "g-ok", title: "日常", last_activity_at: "2026-08-31T08:00:00Z" }),
      ],
    });
    expect(buckets.do.map((g) => g.id)).toEqual(["g-due", "g-stale"]);
    expect(buckets.do[0].reason).toBe("deadline");
    expect(buckets.do[1].reason).toBe("stagnant");
    expect(buckets.leftoverGoalCount).toBe(1);
  });

  it("puts today's morning brief and inbox digest in handled", () => {
    const buckets = buildTodayBuckets({
      now,
      notifications: [
        notif({ id: "mb", type: "morning_brief", title: "早安简报 - 2026-08-31" }),
        notif({ id: "dg", type: "inbox_digest", title: "收件箱摘要" }),
        notif({
          id: "gp",
          type: "goal_progress",
          title: "目标有进展",
          related_id: "g1",
        }),
      ],
    });
    expect(buckets.handled.map((i) => i.kind)).toEqual([
      "morning_brief",
      "inbox_digest",
      "goal_event",
    ]);
  });

  it("keeps only reminder-like types in reminders after related_id dedupe", () => {
    const buckets = buildTodayBuckets({
      now,
      approvals: [{ id: "ap-1", action: "shell_exec" }],
      notifications: [
        notif({ id: "n1", type: "reminder", title: "喝水", related_id: "t1" }),
        notif({ id: "n2", type: "reminder", title: "喝水 again", related_id: "t1" }),
        notif({ id: "n3", type: "url_monitor", title: "页面变了" }),
        notif({ id: "n4", type: "morning_brief", title: "早安" }),
        notif({ id: "n5", type: "goal_stagnant", title: "目标停滞", related_id: "g-stale" }),
      ],
    });
    expect(buckets.reminders.map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(buckets.decide.some((i) => i.kind === "approval")).toBe(true);
    expect(buckets.reminders.every((n) => REMINDER_ONLY_TYPES.has(n.type))).toBe(true);
  });

  it("filters reminder types before truncating to six", () => {
    const notifications = [
      ...Array.from({ length: 8 }, (_, i) =>
        notif({ id: `mb-${i}`, type: "morning_brief", title: `brief ${i}` }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        notif({ id: `r-${i}`, type: "reminder", title: `提醒 ${i}` }),
      ),
    ];
    const buckets = buildTodayBuckets({ now, notifications });
    expect(buckets.reminders).toHaveLength(6);
    expect(buckets.reminders.every((n) => n.type === "reminder")).toBe(true);
  });

  it("returns empty buckets when nothing is happening", () => {
    const buckets = buildTodayBuckets({ now, notifications: [] });
    expect(buckets).toEqual({
      decide: [],
      do: [],
      handled: [],
      leftoverGoalCount: 0,
      reminders: [],
    });
  });
});

describe("dedupeNotifications", () => {
  it("prefers related_id then type:title, and server over live", () => {
    const live: Notification = {
      id: "live-1",
      type: "reminder",
      title: "喝水",
      content: "",
      created_at: "2026-08-31T08:00:00Z",
      source: "live",
      related_id: "t1",
    };
    const server: Notification = {
      id: "srv-1",
      type: "reminder",
      title: "喝水",
      content: "server",
      created_at: "2026-08-31T08:01:00Z",
      source: "server",
      related_id: "t1",
    };
    const merged = mergeLiveAndServerNotifications([server], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("srv-1");
    expect(
      dedupeNotifications([
        { ...live, related_id: null, title: "A" },
        { ...server, related_id: null, title: "A", id: "srv-2" },
      ]).map((n) => n.id),
    ).toEqual(["srv-2"]);
  });
});
