import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOLD_MS,
  isDesktopSmokeMode,
  smokeHoldMs,
  smokeShouldStop,
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
});
