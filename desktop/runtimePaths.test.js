import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  projectVenvPython,
  resolveFrontendFile,
  resolvePythonCommand,
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
