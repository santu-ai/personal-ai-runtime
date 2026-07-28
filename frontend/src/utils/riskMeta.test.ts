import { describe, expect, it } from "vitest";
import { getRiskLevelFromPolicy, getRiskTone, getRiskLevel } from "./riskMeta";
import type { CapabilityPolicy } from "../api/settings";

const samplePolicy: CapabilityPolicy = {
  auto_allow: ["read_file", "web_search"],
  needs_user: ["write_file", "send_email"],
  forbidden: ["shell_exec"],
  external_ingestion: [],
};

describe("getRiskLevelFromPolicy", () => {
  it("maps needs_user to high", () => {
    expect(
      getRiskLevelFromPolicy("shell_exec", { ...samplePolicy, needs_user: ["shell_exec"] }),
    ).toBe("high");
    expect(getRiskLevelFromPolicy("write_file", samplePolicy)).toBe("high");
  });

  it("maps forbidden to high", () => {
    expect(getRiskLevelFromPolicy("shell_exec", samplePolicy)).toBe("high");
  });

  it("maps auto_allow to low", () => {
    expect(getRiskLevelFromPolicy("read_file", samplePolicy)).toBe("low");
  });

  it("defaults unknown tools to medium when policy is present", () => {
    expect(getRiskLevelFromPolicy("unknown_tool", samplePolicy)).toBe("medium");
  });

  it("defaults to medium when policy is missing", () => {
    expect(getRiskLevelFromPolicy("unknown_tool", undefined)).toBe("medium");
    expect(getRiskLevelFromPolicy("shell_exec", null)).toBe("medium");
  });
});

describe("getRiskLevel (deprecated wrapper)", () => {
  it("defaults to medium without policy", () => {
    expect(getRiskLevel("anything")).toBe("medium");
  });
});

describe("getRiskTone", () => {
  it("returns complete tone objects for each level", () => {
    for (const level of ["high", "medium", "low"] as const) {
      const tone = getRiskTone(level);
      expect(tone.container).toBeTruthy();
      expect(tone.icon).toBeTruthy();
      expect(tone.title).toBeTruthy();
      expect(tone.desc).toBeTruthy();
      expect(tone.iconEmoji).toBeTruthy();
    }
  });
});
