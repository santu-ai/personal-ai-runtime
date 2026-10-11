import { describe, expect, it } from "vitest";
import { briefRunLabel, briefStopNotice } from "./briefRunLabel";

const now = 1_700_000_000_000;

describe("briefRunLabel", () => {
  it("shows the live stage and how many sources were read", () => {
    const label = briefRunLabel({
      status: "running",
      isBrief: true,
      workId: "w1",
      steps: [{ tool: "check_inbox" }],
      resumeFrom: 1,
      now,
      progress: {
        workId: "w1",
        stage: "正在写简报",
        sourcesRead: 30,
        sourcesTotal: 30,
        recordedAt: now - 1000,
      },
    });
    expect(label).toBe("正在写简报（30/30 个来源）");
  });

  it("falls back to the plan step when no live stage has arrived", () => {
    const reading = briefRunLabel({
      status: "running",
      isBrief: true,
      workId: "w1",
      steps: [{ tool: "check_inbox" }, { tool: "read_file" }],
      resumeFrom: 0,
      now,
      progress: null,
    });
    expect(reading).toBe("正在读取来源（1/2 个来源）");
    const writing = briefRunLabel({
      status: "running",
      isBrief: true,
      workId: "w1",
      steps: [{ tool: "check_inbox" }, { tool: "read_file" }],
      resumeFrom: 2,
      now,
      progress: null,
    });
    expect(writing).toBe("正在写简报（已读取 2 个来源）");
  });

  it("hides the line once the brief is not running", () => {
    expect(
      briefRunLabel({
        status: "completed",
        isBrief: true,
        workId: "w1",
        steps: [],
        resumeFrom: 0,
        now,
        progress: {
          workId: "w1",
          stage: "正在写简报",
          sourcesRead: 1,
          sourcesTotal: 1,
          recordedAt: now,
        },
      }),
    ).toBeNull();
  });
});

describe("briefStopNotice", () => {
  it("keeps the previous delivery in view after a timeout", () => {
    expect(briefStopNotice("Timeout after 300.0s", true)).toBe(
      "写简报超时。上一版交付还在，可以重新执行。",
    );
    expect(briefStopNotice("Timeout after 300.0s", false)).toBe(
      "写简报超时。这一版还没有交出。可以重新执行。",
    );
  });

  it("says which action comes next after cancel", () => {
    expect(briefStopNotice("cancelled", true)).toBe("已取消。上一版交付还在，可以再次运行。");
    expect(briefStopNotice("cancelled", false)).toBe("已取消。可以重新执行。");
    expect(briefStopNotice("tool step failed: disk full", true)).toBeNull();
  });
});
