import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  projectVenvPython,
  resolveFrontendFile,
  resolvePythonCommand,
  isInternalNavigationUrl,
  isSafeExternalUrl,
  reconnectDelayMs,
  createWsReconnectPolicy,
  attachNotificationSocketHandlers,
  waitForProcessExit,
  isPersonalAiRuntimeHealth,
  inspectBackendHealth,
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

describe("ws reconnect policy", () => {
  it("caps exponential backoff at 60s", () => {
    expect(reconnectDelayMs(0)).toBe(1000);
    expect(reconnectDelayMs(1)).toBe(2000);
    expect(reconnectDelayMs(5)).toBe(32000);
    expect(reconnectDelayMs(6)).toBe(60000);
    expect(reconnectDelayMs(20)).toBe(60000);
  });

  it("keeps a single timer and ignores schedule after stop", () => {
    vi.useFakeTimers();
    const connect = vi.fn();
    const policy = createWsReconnectPolicy({
      initialDelayMs: 1000,
      maxDelayMs: 60000,
    });
    expect(policy.schedule(connect)).toBe(true);
    expect(policy.schedule(connect)).toBe(false);
    expect(policy.hasTimer()).toBe(true);
    policy.stop();
    expect(policy.hasTimer()).toBe(false);
    expect(policy.schedule(connect)).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(connect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("desktop notification socket handlers", () => {
  it("schedules reconnect on close only, even after error", () => {
    const ws = new EventEmitter();
    const reconnect = {
      noteOpen: vi.fn(),
      schedule: vi.fn(() => true),
    };
    const connect = vi.fn();
    const onNotification = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    attachNotificationSocketHandlers(ws, { reconnect, connect, onNotification, logger });

    ws.emit("error", new Error("boom"));
    expect(reconnect.schedule).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();

    ws.emit("close");
    expect(reconnect.schedule).toHaveBeenCalledTimes(1);
    expect(reconnect.schedule).toHaveBeenCalledWith(connect);
  });

  it("does not reconnect after the policy is stopped", () => {
    const ws = new EventEmitter();
    const policy = createWsReconnectPolicy();
    const connect = vi.fn();
    attachNotificationSocketHandlers(ws, { reconnect: policy, connect });
    policy.stop();
    ws.emit("close");
    expect(connect).not.toHaveBeenCalled();
    expect(policy.hasTimer()).toBe(false);
  });
});

describe("backend process exit", () => {
  it("resolves closed when the process exits before the grace period", async () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    proc.kill = vi.fn();
    const done = waitForProcessExit(proc, { graceMs: 5000 });
    await vi.advanceTimersByTimeAsync(2000);
    proc.emit("close", 0);
    await expect(done).resolves.toBe("closed");
    expect(proc.kill).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("force-kills after 5 seconds if close never arrives", async () => {
    vi.useFakeTimers();
    const proc = new EventEmitter();
    proc.kill = vi.fn();
    const done = waitForProcessExit(proc, { graceMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(done).resolves.toBe("killed");
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });
});

describe("backend health identity", () => {
  it("accepts personal-ai-runtime with a matching version", () => {
    expect(
      isPersonalAiRuntimeHealth(
        { service: "personal-ai-runtime", version: "1.0.0" },
        "1.0.0",
      ),
    ).toBe(true);
  });

  it("rejects a foreign service or version mismatch", () => {
    expect(isPersonalAiRuntimeHealth({ service: "nginx" }, "1.0.0")).toBe(false);
    expect(
      isPersonalAiRuntimeHealth(
        { service: "personal-ai-runtime", version: "0.9.0" },
        "1.0.0",
      ),
    ).toBe(false);
  });

  it("classifies health probes as ours, foreign, or unavailable", async () => {
    const ours = await inspectBackendHealth({
      healthUrl: "http://127.0.0.1:8000/api/system/health",
      expectedVersion: "1.0.0",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ service: "personal-ai-runtime", version: "1.0.0" }),
      }),
    });
    expect(ours.kind).toBe("ours");

    const foreign = await inspectBackendHealth({
      healthUrl: "http://127.0.0.1:8000/api/system/health",
      expectedVersion: "1.0.0",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", service: "other-app" }),
      }),
    });
    expect(foreign.kind).toBe("foreign");

    const unavailable = await inspectBackendHealth({
      healthUrl: "http://127.0.0.1:8000/api/system/health",
      expectedVersion: "1.0.0",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(unavailable.kind).toBe("unavailable");
  });
});
