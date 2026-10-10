import { describe, expect, it } from "vitest";
import { formatTime } from "./time";

describe("formatTime", () => {
  it("writes a local clock instead of the raw timestamp", () => {
    const raw = "2026-09-24T08:00:00.844777Z";
    const shown = formatTime(raw);
    expect(shown).toContain("2026");
    expect(shown).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(shown).not.toContain("T08:00:00");
    expect(shown).not.toContain("844777");
  });

  it("keeps a stamp that is not a time", () => {
    const raw = "2026-09-24T08:30:00+08:00-a-long-fire-time-that-used-to-stay-truncated";
    expect(formatTime(raw)).toBe(raw);
  });
});
