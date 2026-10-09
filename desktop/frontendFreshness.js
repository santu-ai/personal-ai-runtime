/**
 * Decide whether desktop packaging must rebuild the frontend.
 *
 * Artifact existence is not enough: a second package run used to copy a
 * leftover frontend/dist even after src/ had changed. Source mtimes are
 * compared with both the Vite dist and the copy electron-builder ships.
 */

const fs = require("fs");
const path = require("path");

const SOURCE_FILES = ["index.html", "package.json", "vite.config.ts"];
const SOURCE_DIRS = ["src", "public"];

function walkFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

function collectSourceFiles(frontendDir) {
  const files = [];
  for (const name of SOURCE_FILES) {
    const full = path.join(frontendDir, name);
    if (fs.existsSync(full)) files.push(full);
  }
  for (const dirName of SOURCE_DIRS) {
    walkFiles(path.join(frontendDir, dirName), files);
  }
  return files;
}

function newestMtimeMs(files) {
  let newest = null;
  for (const file of files) {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (newest === null || stat.mtimeMs > newest) newest = stat.mtimeMs;
  }
  return newest;
}

function needsFrontendBuild({ frontendDir, frontendDist, desktopFrontendDist }) {
  const indexPath = path.join(frontendDist, "index.html");
  if (!fs.existsSync(frontendDist) || !fs.existsSync(indexPath)) return true;
  const indexHtml = fs.readFileSync(indexPath, "utf8");
  if (!indexHtml.includes("./assets/")) return true;
  const desktopIndex = path.join(desktopFrontendDist, "index.html");
  if (!fs.existsSync(desktopFrontendDist) || !fs.existsSync(desktopIndex)) return true;

  let distMtime;
  let desktopMtime;
  try {
    distMtime = fs.statSync(indexPath).mtimeMs;
    desktopMtime = fs.statSync(desktopIndex).mtimeMs;
  } catch {
    return true;
  }

  const sourceMtime = newestMtimeMs(collectSourceFiles(frontendDir));
  if (sourceMtime === null) return false;
  return sourceMtime > distMtime || sourceMtime > desktopMtime;
}

module.exports = {
  collectSourceFiles,
  needsFrontendBuild,
};
