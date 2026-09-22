import { describe, expect, it } from "vitest";
import { goalProgressPercent } from "./goalProgress";

describe("goalProgressPercent", () => {
  it("treats 0–1 as a ratio", () => {
    expect(goalProgressPercent(0)).toBe(0);
    expect(goalProgressPercent(0.3)).toBeCloseTo(30);
    expect(goalProgressPercent(1)).toBe(100);
  });

  it("keeps values above 1 as percentages", () => {
    expect(goalProgressPercent(30)).toBe(30);
    expect(goalProgressPercent(150)).toBe(100);
  });

  it("rejects non-finite and negative values", () => {
    expect(goalProgressPercent(Number.NaN)).toBe(0);
    expect(goalProgressPercent(-0.2)).toBe(0);
  });
});
