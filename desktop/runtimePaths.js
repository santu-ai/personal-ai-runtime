const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function projectVenvPython(repoRoot) {
  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  const exe = process.platform === "win32" ? "python.exe" : "python";
  return [
    path.join(repoRoot, ".venv", binDir, exe),
    path.join(repoRoot, "backend", ".venv", binDir, exe),
  ];
}

function resolvePythonCommand({ isPackaged, bundledPythonExe, repoRoot }) {
  if (bundledPythonExe) {
    return { executable: bundledPythonExe, args: [] };
  }
  if (!isPackaged) {
    for (const candidate of projectVenvPython(repoRoot)) {
      if (fs.existsSync(candidate)) {
        return { executable: candidate, args: [] };
      }
    }
  }
  if (process.platform === "win32") {
    const pyLauncher = spawnSync("py", ["-3.12", "--version"], { stdio: "ignore" });
    if (pyLauncher.status === 0) {
      return { executable: "py", args: ["-3.12"] };
    }
    const python = spawnSync("python", ["--version"], { stdio: "ignore" });
    if (python.status === 0) {
      return { executable: "python", args: [] };
    }
  }
  const python3 = spawnSync("python3", ["--version"], { stdio: "ignore" });
  if (python3.status === 0) {
    return { executable: "python3", args: [] };
  }
  const python = spawnSync("python", ["--version"], { stdio: "ignore" });
  if (python.status === 0) {
    return { executable: "python", args: [] };
  }
  return {
    executable: process.platform === "win32" ? "py" : "python3",
    args: process.platform === "win32" ? ["-3.12"] : [],
  };
}

function resolveFrontendFile(distRoot, relPath) {
  if (!relPath || relPath === ".") {
    return path.join(distRoot, "index.html");
  }
  const normalized = relPath.replace(/\\/g, "/");
  if (
    normalized.includes("..") ||
    path.isAbsolute(normalized) ||
    normalized.startsWith("/")
  ) {
    return path.join(distRoot, "index.html");
  }
  const candidate = path.normalize(path.join(distRoot, normalized));
  if (candidate !== distRoot && !candidate.startsWith(distRoot + path.sep)) {
    return path.join(distRoot, "index.html");
  }
  if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  if (normalized.startsWith("assets/")) {
    return candidate;
  }
  return path.join(distRoot, "index.html");
}

module.exports = {
  projectVenvPython,
  resolvePythonCommand,
  resolveFrontendFile,
};
