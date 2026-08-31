import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  projectVenvPython,
  resolveFrontendFile,
  resolvePythonCommand,
  isInternalNavigationUrl,
  isSafeExternalUrl,
} from "./runtimePaths.js";

describe("runtimePaths", () => {
  it("prefers project venv python in dev mode", () => {
    const repoRoot = path.join(os.tmpdir(), "par-test-repo");
    const venvPy = projectVenvPython(repoRoot)[0];
    fs.mkdirSync(path.dirname(venvPy), { recursive: true });
    fs.writeFileSync(venvPy, "");

    const cmd = resolvePythonCommand({
      isPackaged: false,
      bundledPythonExe: null,
      repoRoot,
    });
    expect(cmd.executable).toBe(venvPy);
    expect(cmd.args).toEqual([]);
  });

  it("blocks path traversal in resolveFrontendFile", () => {
    const distRoot = path.join(os.tmpdir(), "par-dist");
    const resolved = resolveFrontendFile(distRoot, "../secret.txt");
    expect(resolved).toBe(path.join(distRoot, "index.html"));
  });

  it("serves existing asset files under distRoot", () => {
    const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "par-dist-"));
    const assetPath = path.join(distRoot, "assets", "app.js");
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, "console.log('ok');");

    const resolved = resolveFrontendFile(distRoot, "assets/app.js");
    expect(resolved).toBe(assetPath);
  });
});

describe("navigation policy", () => {
  it("allows app:// and the Vite loopback origin in dev", () => {
    expect(isInternalNavigationUrl("app://./chat", { isPackaged: true })).toBe(true);
    expect(
      isInternalNavigationUrl("http://127.0.0.1:5173/chat", {
        isPackaged: false,
        devOrigin: "http://127.0.0.1:5173",
      }),
    ).toBe(true);
    expect(
      isInternalNavigationUrl("https://example.com/", {
        isPackaged: false,
        devOrigin: "http://127.0.0.1:5173",
      }),
    ).toBe(false);
    expect(isInternalNavigationUrl("https://example.com/", { isPackaged: true })).toBe(false);
  });

  it("only treats http(s) as safe external URLs", () => {
    expect(isSafeExternalUrl("https://example.com/docs")).toBe(true);
    expect(isSafeExternalUrl("http://127.0.0.1:9999")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
