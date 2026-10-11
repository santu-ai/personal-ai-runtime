/**
 * Unattended packaged-app launch used by the clean Windows install job.
 *
 * PAR_DESKTOP_SMOKE=1 skips the first-run dialog and does not show a window.
 * The process starts the embedded backend, waits in a hidden window until the
 * Today heading is visible, writes a JSON result, and stays up until
 * PAR_DESKTOP_SMOKE_DONE appears or the hold elapses.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_HOLD_MS = 180000;
const BACKEND_POLL_MS = 500;
const TODAY_PROBE_DELAY_MS = 200;
const TODAY_PROBE_TIMEOUT_MS = 60000;

function isDesktopSmokeMode(env = process.env) {
  return String(env.PAR_DESKTOP_SMOKE || "") === "1";
}

function smokeHoldMs(env = process.env) {
  const raw = env.PAR_DESKTOP_SMOKE_HOLD_MS;
  if (raw == null || raw === "") return DEFAULT_HOLD_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_HOLD_MS;
  return n;
}

function smokeResultPath(env = process.env) {
  return env.PAR_DESKTOP_SMOKE_RESULT || "";
}

function smokeDonePath(env = process.env) {
  return env.PAR_DESKTOP_SMOKE_DONE || "";
}

function smokeUserDataDir(env = process.env) {
  return env.PAR_DESKTOP_USER_DATA || "";
}

function writeSmokeResult(env, result) {
  const payload = JSON.stringify(result);
  const dest = smokeResultPath(env);
  if (dest) {
    fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, dest);
  }
  console.log(`PAR_DESKTOP_SMOKE_RESULT ${payload}`);
  return payload;
}

function smokeShouldStop(env, startedAt, now, existsSync = fs.existsSync) {
  const done = smokeDonePath(env);
  if (done && existsSync(done)) return true;
  return now - startedAt >= smokeHoldMs(env);
}

function backendPollMs() {
  return BACKEND_POLL_MS;
}

function todayProbeDelayMs() {
  return TODAY_PROBE_DELAY_MS;
}

function todayProbeTimeoutMs() {
  return TODAY_PROBE_TIMEOUT_MS;
}

function todayHeadingScript() {
  return `(() => {
    const nodes = document.querySelectorAll("h1, h2, h3");
    for (const node of nodes) {
      if ((node.textContent || "").trim() === "今天") return true;
    }
    return false;
  })()`;
}

function finiteMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value);
}

function phaseMap(phases) {
  const out = {};
  if (!phases || typeof phases !== "object") return out;
  for (const [key, value] of Object.entries(phases)) {
    const ms = finiteMs(value);
    if (ms == null) continue;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) continue;
    out[key] = ms;
  }
  return out;
}

function coldStartReport({
  backendReadyMs,
  todayReadyMs,
  todayError,
  nowMs,
  probeMs,
  dashboardMs,
  splashReadyMs,
  phases,
}) {
  return {
    sinceLaunchMs: nowMs,
    backendReadyMs: backendReadyMs == null ? null : backendReadyMs,
    todayReadyMs: todayReadyMs == null ? null : todayReadyMs,
    todayOk: todayReadyMs != null && !todayError,
    todayError: todayError || "",
    probeMs: finiteMs(probeMs),
    dashboardMs: finiteMs(dashboardMs),
    splashReadyMs: finiteMs(splashReadyMs),
    phases: phaseMap(phases),
  };
}

function coldStartDistribution(samples) {
  const nums = (Array.isArray(samples) ? samples : [])
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .map((value) => Math.round(value))
    .sort((a, b) => a - b);
  if (nums.length === 0) return { median: null, max: null, count: 0 };
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 === 1
    ? nums[mid]
    : Math.round((nums[mid - 1] + nums[mid]) / 2);
  return { median, max: nums[nums.length - 1], count: nums.length };
}

module.exports = {
  DEFAULT_HOLD_MS,
  isDesktopSmokeMode,
  smokeHoldMs,
  smokeResultPath,
  smokeDonePath,
  smokeUserDataDir,
  writeSmokeResult,
  smokeShouldStop,
  backendPollMs,
  todayProbeDelayMs,
  todayProbeTimeoutMs,
  todayHeadingScript,
  coldStartReport,
  coldStartDistribution,
};
