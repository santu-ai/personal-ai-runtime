import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { needsFrontendBuild } from "./frontendFreshness.js";

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function touch(file, mtimeMs) {
  const when = new Date(mtimeMs);
  fs.utimesSync(file, when, when);
}

function layout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "par-fresh-"));
  const frontendDir = path.join(root, "frontend");
  const frontendDist = path.join(frontendDir, "dist");
  const desktopFrontendDist = path.join(root, "desktop", "frontend-dist");
  write(path.join(frontendDir, "src", "main.tsx"), "export {}\n");
  write(path.join(frontendDir, "index.html"), "<div id=\"root\"></div>\n");
  write(path.join(frontendDir, "package.json"), "{}\n");
  write(path.join(frontendDir, "vite.config.ts"), "export default {}\n");
  write(path.join(frontendDist, "index.html"), '<script src="./assets/app.js"></script>\n');
  write(path.join(frontendDist, "assets", "app.js"), "console.log(1)\n");
  write(path.join(desktopFrontendDist, "index.html"), '<script src="./assets/app.js"></script>\n');
  const base = Date.now() - 60_000;
  for (const file of [
    path.join(frontendDir, "src", "main.tsx"),
    path.join(frontendDir, "index.html"),
    path.join(frontendDir, "package.json"),
    path.join(frontendDir, "vite.config.ts"),
  ]) {
    touch(file, base);
  }
  touch(path.join(frontendDist, "index.html"), base + 10_000);
  touch(path.join(desktopFrontendDist, "index.html"), base + 10_000);
  return { frontendDir, frontendDist, desktopFrontendDist, base };
}

describe("needsFrontendBuild", () => {
  it("rebuilds when the desktop bundle is missing", () => {
    const dirs = layout();
    fs.rmSync(dirs.desktopFrontendDist, { recursive: true, force: true });
    expect(needsFrontendBuild(dirs)).toBe(true);
  });

  it("rebuilds when the vite dist lacks relative asset paths", () => {
    const dirs = layout();
    write(path.join(dirs.frontendDist, "index.html"), '<script src="/assets/app.js"></script>\n');
    expect(needsFrontendBuild(dirs)).toBe(true);
  });

  it("skips the build when artifacts are newer than sources", () => {
    const dirs = layout();
    expect(needsFrontendBuild(dirs)).toBe(false);
  });

  it("rebuilds when a source file is newer than the packaged copy", () => {
    const dirs = layout();
    touch(path.join(dirs.frontendDir, "src", "main.tsx"), dirs.base + 30_000);
    expect(needsFrontendBuild(dirs)).toBe(true);
  });

  it("rebuilds when sources are newer than vite dist but the desktop copy looks current", () => {
    const dirs = layout();
    touch(path.join(dirs.frontendDist, "index.html"), dirs.base);
    touch(path.join(dirs.desktopFrontendDist, "index.html"), dirs.base + 30_000);
    touch(path.join(dirs.frontendDir, "src", "main.tsx"), dirs.base + 5_000);
    expect(needsFrontendBuild(dirs)).toBe(true);
  });
});
