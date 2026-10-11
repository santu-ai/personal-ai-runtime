import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOLD_MS,
  backendPollMs,
  coldStartDistribution,
  coldStartReport,
  isDesktopSmokeMode,
  smokeHoldMs,
  smokeShouldStop,
  todayHeadingScript,
  writeSmokeResult,
} from "./smokeMode.js";

describe("desktop smoke mode", () => {
  it("is enabled only by PAR_DESKTOP_SMOKE=1", () => {
    expect(isDesktopSmokeMode({ PAR_DESKTOP_SMOKE: "1" })).toBe(true);
    expect(isDesktopSmokeMode({ PAR_DESKTOP_SMOKE: "true" })).toBe(false);
    expect(isDesktopSmokeMode({})).toBe(false);
  });

  it("falls back when the hold is missing or not a duration", () => {
    expect(smokeHoldMs({})).toBe(DEFAULT_HOLD_MS);
    expect(smokeHoldMs({ PAR_DESKTOP_SMOKE_HOLD_MS: "0" })).toBe(0);
    expect(smokeHoldMs({ PAR_DESKTOP_SMOKE_HOLD_MS: "2500" })).toBe(2500);
    expect(smokeHoldMs({ PAR_DESKTOP_SMOKE_HOLD_MS: "-1" })).toBe(DEFAULT_HOLD_MS);
    expect(smokeHoldMs({ PAR_DESKTOP_SMOKE_HOLD_MS: "nope" })).toBe(DEFAULT_HOLD_MS);
  });

  it("stops when the done file exists or the hold elapses", () => {
    const env = { PAR_DESKTOP_SMOKE_DONE: "C:\\smoke\\done", PAR_DESKTOP_SMOKE_HOLD_MS: "1000" };
    expect(smokeShouldStop(env, 0, 100, () => true)).toBe(true);
    expect(smokeShouldStop(env, 0, 999, () => false)).toBe(false);
    expect(smokeShouldStop(env, 0, 1000, () => false)).toBe(true);
  });

  it("writes the result atomically as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "par-smoke-"));
    const dest = join(dir, "nested", "result.json");
    try {
      const payload = writeSmokeResult(
        { PAR_DESKTOP_SMOKE_RESULT: dest },
        { ok: true, packaged: true },
      );
      expect(JSON.parse(payload)).toEqual({ ok: true, packaged: true });
      expect(JSON.parse(readFileSync(dest, "utf8"))).toEqual({ ok: true, packaged: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports launch-to-today timings without treating a missing heading as ready", () => {
    expect(backendPollMs()).toBe(500);
    expect(todayHeadingScript()).toContain('=== "今天"');
    expect(coldStartReport({
      backendReadyMs: 1400,
      todayReadyMs: 2600,
      todayError: "",
      nowMs: 2700,
      probeMs: 12.4,
      dashboardMs: 240,
      phases: { migration: 80, chroma_client: 400, embed: 0, secret: "no", "Bad-Name": 1 },
    })).toEqual({
      sinceLaunchMs: 2700,
      backendReadyMs: 1400,
      todayReadyMs: 2600,
      todayOk: true,
      todayError: "",
      probeMs: 12,
      dashboardMs: 240,
      phases: { migration: 80, chroma_client: 400, embed: 0 },
    });
    expect(coldStartReport({
      backendReadyMs: 1400,
      todayReadyMs: null,
      todayError: "today-heading-timeout",
      nowMs: 62000,
    }).todayOk).toBe(false);
  });

  it("summarizes a cold-start sample as median and max", () => {
    expect(coldStartDistribution([8152, 6110, 8827, 7000, 6400])).toEqual({
      median: 7000,
      max: 8827,
      count: 5,
    });
    expect(coldStartDistribution([1000, 3000])).toEqual({ median: 2000, max: 3000, count: 2 });
    expect(coldStartDistribution([1500, null, 2500])).toEqual({ median: 2000, max: 2500, count: 2 });
    expect(coldStartDistribution([])).toEqual({ median: null, max: null, count: 0 });
    const verify = readFileSync(join(__dirname, "verify-windows-install.ps1"), "utf8");
    expect(verify).toContain("$ColdStartRuns = 5");
    expect(verify).toContain("function Get-Median");
  });
});
