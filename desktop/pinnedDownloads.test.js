import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSha256,
  expectedEmbedSha256,
  reproducibleBuildRequested,
  sha256File,
} from "./pinnedDownloads.js";

describe("pinned desktop downloads", () => {
  it("checks a file against its sha256", () => {
    const dir = mkdtempSync(join(tmpdir(), "par-pin-"));
    const file = join(dir, "blob.bin");
    try {
      writeFileSync(file, "personal-ai-runtime");
      const digest = sha256File(file);
      expect(assertSha256(file, digest, "blob.bin")).toBe(digest);
      expect(() => assertSha256(file, "0".repeat(64), "blob.bin")).toThrow(/sha256 mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an embed zip that has no pin", () => {
    expect(expectedEmbedSha256("python-3.12.8-embed-amd64.zip")).toHaveLength(64);
    expect(() => expectedEmbedSha256("python-0-embed-amd64.zip")).toThrow(/No pinned sha256/);
  });

  it("treats CI and SOURCE_DATE_EPOCH as a reproducible build", () => {
    expect(reproducibleBuildRequested({})).toBe(false);
    expect(reproducibleBuildRequested({ CI: "true" })).toBe(true);
    expect(reproducibleBuildRequested({ SOURCE_DATE_EPOCH: "1700000000" })).toBe(true);
  });
});
