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

function isInternalNavigationUrl(url, { isPackaged, devOrigin = "http://127.0.0.1:5173" } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "app:") return true;
  if (isPackaged) return false;
  return parsed.origin === devOrigin;
}

function isSafeExternalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function reconnectDelayMs(attempt, { initialMs = 1000, maxMs = 60000 } = {}) {
  const safeAttempt = Math.max(0, Number(attempt) || 0);
  return Math.min(maxMs, initialMs * 2 ** safeAttempt);
}

function createWsReconnectPolicy({
  initialDelayMs = 1000,
  maxDelayMs = 60000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let timer = null;
  let attempt = 0;
  let stopped = false;

  function schedule(connectFn) {
    if (stopped || timer != null || typeof connectFn !== "function") return false;
    const delay = reconnectDelayMs(attempt, { initialMs: initialDelayMs, maxMs: maxDelayMs });
    attempt += 1;
    timer = setTimeoutFn(() => {
      timer = null;
      connectFn();
    }, delay);
    return true;
  }

  function noteOpen() {
    attempt = 0;
  }

  function cancelTimer() {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  function stop() {
    stopped = true;
    cancelTimer();
  }

  function reset() {
    stopped = false;
    cancelTimer();
    attempt = 0;
  }

  return {
    schedule,
    noteOpen,
    cancelTimer,
    stop,
    reset,
    getAttempt: () => attempt,
    hasTimer: () => timer != null,
    isStopped: () => stopped,
  };
}

function attachNotificationSocketHandlers(ws, {
  reconnect,
  connect,
  onNotification,
  logger = console,
} = {}) {
  if (!ws || typeof ws.on !== "function") return;

  ws.on("open", () => {
    if (reconnect && typeof reconnect.noteOpen === "function") reconnect.noteOpen();
    if (logger && typeof logger.log === "function") {
      logger.log("WebSocket connected for notifications");
    }
  });

  ws.on("message", (data) => {
    try {
      const raw = typeof data === "string" ? data : data && data.toString ? data.toString() : "";
      const event = JSON.parse(raw);
      if (event && event.type === "notification" && typeof onNotification === "function") {
        onNotification(event);
      }
    } catch {
      // Ignore parse errors
    }
  });

  ws.on("error", (err) => {
    if (logger && typeof logger.error === "function") {
      logger.error("WebSocket error:", err && err.message ? err.message : err);
    }
  });

  ws.on("close", () => {
    if (reconnect && typeof reconnect.schedule === "function") {
      reconnect.schedule(connect);
    }
  });
}

function waitForProcessExit(proc, {
  graceMs = 5000,
  killSignal = "SIGKILL",
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  return new Promise((resolve) => {
    if (!proc) {
      resolve("missing");
      return;
    }
    let settled = false;
    let timer = null;
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeoutFn(timer);
      resolve(reason);
    };
    if (typeof proc.once === "function") {
      proc.once("close", () => finish("closed"));
    }
    timer = setTimeoutFn(() => {
      try {
        if (typeof proc.kill === "function") proc.kill(killSignal);
      } catch {
        // Process already gone.
      }
      finish("killed");
    }, graceMs);
  });
}

function isPersonalAiRuntimeHealth(payload, expectedVersion) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.service !== "personal-ai-runtime") return false;
  if (
    expectedVersion &&
    payload.version != null &&
    String(payload.version) !== String(expectedVersion)
  ) {
    return false;
  }
  return true;
}

async function inspectBackendHealth({ fetchImpl, healthUrl, expectedVersion } = {}) {
  if (typeof fetchImpl !== "function" || !healthUrl) {
    return { kind: "unavailable" };
  }
  try {
    const res = await fetchImpl(healthUrl);
    const status = res && typeof res.status === "number" ? res.status : 0;
    let payload = null;
    try {
      if (res && typeof res.json === "function") {
        payload = await res.json();
      } else if (res && typeof res.text === "function") {
        payload = JSON.parse(await res.text());
      }
    } catch {
      payload = null;
    }
    if (res && res.ok && isPersonalAiRuntimeHealth(payload, expectedVersion)) {
      return { kind: "ours", status, payload };
    }
    if (res && res.ok) {
      return { kind: "foreign", status, payload };
    }
    return { kind: "unavailable", status, payload };
  } catch (error) {
    return { kind: "unavailable", error };
  }
}

module.exports = {
  projectVenvPython,
  resolvePythonCommand,
  resolveFrontendFile,
  isInternalNavigationUrl,
  isSafeExternalUrl,
  reconnectDelayMs,
  createWsReconnectPolicy,
  attachNotificationSocketHandlers,
  waitForProcessExit,
  isPersonalAiRuntimeHealth,
  inspectBackendHealth,
};
