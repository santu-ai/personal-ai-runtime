import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPLASH_BACKEND,
  SPLASH_DATA,
  SPLASH_FAILED,
  SPLASH_STARTING,
  splashReadyScript,
  splashStatusScript,
} from "./splash.js";

describe("startup splash", () => {
  it("starts with a visible status and can move to backend, data, or failure", () => {
    const html = readFileSync(join(__dirname, "splash.html"), "utf8");
    expect(html).toContain(`id="splash-status">${SPLASH_STARTING}`);
    expect(html).not.toContain("今天");
    expect(splashReadyScript()).toContain("splash-status");
    expect(splashStatusScript(SPLASH_BACKEND)).toContain(JSON.stringify(SPLASH_BACKEND));
    expect(splashStatusScript(SPLASH_DATA)).toContain(JSON.stringify(SPLASH_DATA));
    expect(splashStatusScript(SPLASH_FAILED)).toContain(JSON.stringify(SPLASH_FAILED));
    expect(splashStatusScript('say "hello"')).toContain('\\"hello\\"');
  });
});
