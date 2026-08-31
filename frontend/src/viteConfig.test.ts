import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Vite dev server bind", () => {
  it("defaults to 127.0.0.1 and only enables LAN with auth", () => {
    const cfg = readFileSync(path.join(frontendRoot, "vite.config.ts"), "utf8");
    expect(cfg).toContain('host: lanDevEnabled ? true : "127.0.0.1"');
    expect(cfg).toContain("VITE_DEV_LAN");
    expect(cfg).toContain("VITE_AUTH_TOKEN");
    expect(cfg).not.toMatch(/^\s*host:\s*true,/m);
  });
});
