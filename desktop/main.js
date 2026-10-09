/**
 * Electron main process for Personal AI Runtime Desktop.
 *
 * Provides:
 * - System tray icon with quick actions
 * - Global shortcut (Alt+Space) for quick chat
 * - Quick capture (Alt+Shift+I) for Inbox
 * - Native notifications
 * - Auto-start on login
 * - Backend process management (auto-start/stop)
 * - Loads the web app in a frameless window
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, Notification, dialog, nativeImage, protocol, session, shell, net: electronNet } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  resolvePythonCommand: resolvePythonCommandImpl,
  resolveFrontendFile: resolveFrontendFileImpl,
  isInternalNavigationUrl,
  isSafeExternalUrl,
  createWsReconnectPolicy,
  attachNotificationSocketHandlers,
  waitForProcessExit,
  inspectBackendHealth,
} = require("./runtimePaths");
const {
  isDesktopSmokeMode,
  smokeUserDataDir,
  writeSmokeResult,
  smokeShouldStop,
} = require("./smokeMode");

if (isDesktopSmokeMode()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  const smokeUserData = smokeUserDataDir();
  if (smokeUserData) {
    app.setPath("userData", path.resolve(smokeUserData));
  }
}

// Declare the app:// scheme as privileged BEFORE app is ready.
// This must happen synchronously at module load time so the renderer can use
// fetch, cookies, service workers, and relative URLs under app://
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      codeCache: true,
    },
  },
]);

// ── Configuration ────────────────────────────────────────────────────

const WEB_URL = process.env.WEB_URL || "";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:8000";
const BACKEND_PORT = new URL(BACKEND_URL).port || "8000";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

// Production: app.isPackaged is true for electron-builder output.
// In production we load the bundled frontend-dist/index.html via a custom
// `app://` protocol (registered in registerAppProtocol) and proxy /api + /ws
// to the local backend via session.webRequest. In dev we use the Vite dev
// server (http://127.0.0.1:5173) which already proxies /api and /ws.
const isPackaged = app.isPackaged;

// Resolve the frontend entry: app:// protocol in production, dev server otherwise.
// WEB_URL env var always wins (lets dev override).
function resolveWebUrl() {
  if (WEB_URL) return WEB_URL;
  if (isPackaged) {
    const distDir = path.join(__dirname, "frontend-dist");
    if (fs.existsSync(path.join(distDir, "index.html"))) {
      // Use app://./ so location.pathname is "/" and React Router matches.
      return "app://./";
    }
    console.warn("[desktop] Packaged but frontend-dist/index.html missing, falling back to dev URL.");
  }
  return "http://127.0.0.1:5173";
}

// Resolve backend working directory.
function resolveBackendDir() {
  if (isPackaged) {
    return path.join(process.resourcesPath, "backend");
  }
  return path.join(__dirname, "..", "backend");
}

function resolveBundledPythonExe() {
  if (!isPackaged) return null;
  const candidate = path.join(process.resourcesPath, "python", "python.exe");
  return fs.existsSync(candidate) ? candidate : null;
}

function resolvePythonCommand() {
  return resolvePythonCommandImpl({
    isPackaged,
    bundledPythonExe: resolveBundledPythonExe(),
    repoRoot: path.join(__dirname, ".."),
  });
}

function resolveDesktopDataEnv() {
  const dataDir = path.join(app.getPath("userData"), "data");
  const vectorDir = path.join(dataDir, "vectors");
  fs.mkdirSync(vectorDir, { recursive: true });
  return {
    DATA_DIR: dataDir,
    VECTOR_DIR: vectorDir,
    SQLITE_PATH: path.join(dataDir, "personal_ai.db"),
  };
}

function verifyPythonDependencies(pythonCmd, backendDir, extraEnv) {
  const env = { ...process.env, ...extraEnv, BACKEND_DIR: backendDir };
  const escapedDir = backendDir.replace(/\\/g, "\\\\");
  const importProbe = `import sys; sys.path.insert(0, r'${escapedDir}'); import uvicorn, chromadb, app.main`;
  const probe = spawnSync(pythonCmd.executable, [...pythonCmd.args, "-c", importProbe], {
    cwd: backendDir,
    env,
    stdio: "ignore",
  });
  return probe.status === 0;
}

function showPythonSetupError() {
  const detail =
    process.platform === "win32"
      ? "未找到可用的 Python 3.12 或依赖未安装。\n请运行 install.bat，或从 README 查看安装说明。"
      : "Python 3.12+ with backend requirements is required.\nRun: bash install.sh";
  if (isDesktopSmokeMode()) {
    console.error(detail);
    return;
  }
  dialog.showErrorBox("Personal AI Runtime — 后端启动失败", detail);
}

function readAppVersion() {
  try {
    const versionPath = path.join(__dirname, "..", "VERSION");
    return fs.readFileSync(versionPath, "utf8").trim();
  } catch {
    return "1.0.0";
  }
}

const APP_VERSION = readAppVersion();
const RESOLVED_WEB_URL = resolveWebUrl();
const RESOLVED_BACKEND_DIR = resolveBackendDir();

// ── Custom protocol + request proxying (production only) ─────────────
//
// In production the renderer loads `app://./index.html`. The `app://` scheme
// serves files from frontend-dist/. API calls to `/api/*` and WebSocket
// upgrades to `/ws` are rewritten to the local backend via webRequest so the
// frontend's relative API_BASE ("/api") works unchanged.

let _appProtocolRegistered = false;

function registerAppProtocol() {
  if (_appProtocolRegistered || !isPackaged) return;

  const distRoot = path.join(__dirname, "frontend-dist");
  const backendOrigin = `http://127.0.0.1:${BACKEND_PORT}`;

  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    // url.hostname is "." for app://./path ; url.pathname is the file path.
    let relPath = decodeURIComponent(url.pathname);
    if (relPath.startsWith("/")) relPath = relPath.slice(1);

    // Fallback proxy when webRequest redirect does not apply.
    if (relPath === "api" || relPath.startsWith("api/")) {
      const target = `${backendOrigin}/${relPath}${url.search}`;
      return electronNet.fetch(target, {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      });
    }

    const filePath = resolveFrontendFileImpl(distRoot, relPath);
    return electronNet.fetch(pathToFileURL(filePath).href);
  });
  _appProtocolRegistered = true;
}

function resolveFrontendFile(distRoot, relPath) {
  return resolveFrontendFileImpl(distRoot, relPath);
}

function installNavigationGuards(win) {
  const opts = { isPackaged, devOrigin: "http://127.0.0.1:5173" };
  win.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigationUrl(url, opts)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalNavigationUrl(url, opts)) {
      return { action: "allow" };
    }
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

function installApiProxy() {
  if (!isPackaged) return;
  const backendOrigin = `http://127.0.0.1:${BACKEND_PORT}`;
  const wsOrigin = `ws://127.0.0.1:${BACKEND_PORT}`;
  const ses = session.defaultSession;

  const redirectApi = (details, callback) => {
    const apiIndex = details.url.indexOf("/api");
    if (apiIndex === -1) {
      callback({});
      return;
    }
    callback({ redirectURL: `${backendOrigin}${details.url.slice(apiIndex)}` });
  };

  ses.webRequest.onBeforeRequest(
    {
      urls: [
        "http://localhost/api/*",
        "http://127.0.0.1/api/*",
        "app://*/api/*",
        "app://./api/*",
      ],
    },
    redirectApi,
  );

  const redirectWs = (details, callback) => {
    const wsIndex = details.url.indexOf("/ws");
    if (wsIndex === -1) {
      callback({});
      return;
    }
    callback({ redirectURL: `${wsOrigin}${details.url.slice(wsIndex)}` });
  };

  ses.webRequest.onBeforeRequest(
    {
      urls: [
        "ws://localhost/ws*",
        "ws://127.0.0.1/ws*",
        "ws://./ws*",
        "ws://*/ws*",
      ],
    },
    redirectWs,
  );
}

// ── Backend Process Management ───────────────────────────────────────

let backendProcess = null;
let backendStarting = false;
let backendLog = "";
let backendExitCode = null;

function rememberBackendLog(chunk) {
  backendLog = `${backendLog}${chunk}`.slice(-4000);
}

function resolveBackendLauncher() {
  // Packaged main.js lives in app.asar. Python reads the real filesystem, so the
  // launcher has to be the extraResources copy under resources/.
  if (isPackaged) {
    return path.join(process.resourcesPath, "run-backend.py");
  }
  return path.join(__dirname, "run-backend.py");
}

function backendHealthUrl() {
  return `http://127.0.0.1:${BACKEND_PORT}/api/system/health`;
}

async function probeLocalBackend() {
  return inspectBackendHealth({
    fetchImpl: (url) => electronNet.fetch(url),
    healthUrl: backendHealthUrl(),
    expectedVersion: APP_VERSION,
  });
}

async function waitForBackendReady(maxWaitMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const probe = await probeLocalBackend();
    if (probe.kind === "ours") return true;
    if (probe.kind === "foreign") return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function showPortConflictError() {
  const detail =
    `端口 ${BACKEND_PORT} 已被其他服务占用，且响应不是 Personal AI Runtime（service/version 不匹配）。\n请关闭占用该端口的程序，或设置 BACKEND_URL 使用其他端口。`;
  if (isDesktopSmokeMode()) {
    console.error(detail);
    return;
  }
  dialog.showErrorBox("Personal AI Runtime — 端口冲突", detail);
}

async function startBackend() {
  if (backendProcess || backendStarting) return "busy";

  backendStarting = true;
  const backendDir = RESOLVED_BACKEND_DIR;
  try {
    const probe = await probeLocalBackend();
    if (probe.kind === "ours") {
      console.log("Backend already running on port", BACKEND_PORT);
      return "reused";
    }
    if (probe.kind === "foreign") {
      showPortConflictError();
      return "conflict";
    }

    console.log("Starting backend...");

    const pythonCmd = resolvePythonCommand();
    const dataEnv = resolveDesktopDataEnv();
    const spawnEnv = {
      ...process.env,
      ...dataEnv,
      BACKEND_DIR: backendDir,
      BACKEND_HOST: "127.0.0.1",
      BACKEND_PORT: String(BACKEND_PORT),
    };

    if (!verifyPythonDependencies(pythonCmd, backendDir, dataEnv)) {
      console.error("Python dependencies missing for", pythonCmd.executable);
      showPythonSetupError();
      return "failed";
    }

    const launcherPath = resolveBackendLauncher();
    if (!fs.existsSync(launcherPath)) {
      console.error("Backend launcher missing:", launcherPath);
      showPythonSetupError();
      return "failed";
    }

    backendLog = "";
    backendExitCode = null;
    backendProcess = spawn(pythonCmd.executable, [...pythonCmd.args, launcherPath], {
      cwd: backendDir,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    backendProcess.stdout.on("data", (data) => {
      rememberBackendLog(data.toString());
      console.log("[backend]", data.toString().trim());
    });

    backendProcess.stderr.on("data", (data) => {
      rememberBackendLog(data.toString());
      console.log("[backend]", data.toString().trim());
    });

    backendProcess.on("close", (code) => {
      backendExitCode = code;
      console.log("Backend exited with code", code);
      backendProcess = null;
    });

    backendProcess.on("error", (err) => {
      console.error("Backend start error:", err.message);
      showPythonSetupError();
      backendProcess = null;
    });

    return "spawned";
  } finally {
    backendStarting = false;
  }
}

function stopBackend() {
  if (!backendProcess) return Promise.resolve("missing");
  const proc = backendProcess;
  console.log("Stopping backend...");
  try {
    proc.kill("SIGTERM");
  } catch {
    if (backendProcess === proc) backendProcess = null;
    return Promise.resolve("missing");
  }
  return waitForProcessExit(proc, { graceMs: 5000 }).then((reason) => {
    if (backendProcess === proc) backendProcess = null;
    return reason;
  });
}

// ── Window State ─────────────────────────────────────────────────────

let mainWindow = null;
let miniWindow = null;
let tray = null;
let isQuitting = false;

function createTrayIcon() {
  // Use the generated icon.png if available, otherwise fall back to a colored square
  const iconPath = path.join(__dirname, "icon.png");
  let trayIcon;
  try {
    if (fs.existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
      // macOS tray icons should be small
      if (process.platform === "darwin") {
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
      }
    } else {
      trayIcon = createFallbackIcon();
    }
  } catch {
    trayIcon = createFallbackIcon();
  }
  return trayIcon;
}

function createFallbackIcon() {
  // Fallback: empty 16x16 icon (icon.png should be generated by postinstall script)
  return nativeImage.createEmpty();
}

function createMainWindow() {
  const iconPath = path.join(__dirname, "icon.png");
  const winOpts = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Personal AI Runtime",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    frame: true,
    show: false,
  };
  if (fs.existsSync(iconPath)) {
    winOpts.icon = iconPath;
  }

  mainWindow = new BrowserWindow(winOpts);
  installNavigationGuards(mainWindow);
  mainWindow.loadURL(RESOLVED_WEB_URL);

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createMiniWindow() {
  if (miniWindow) {
    miniWindow.focus();
    return;
  }

  miniWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  installNavigationGuards(miniWindow);
  miniWindow.loadURL(RESOLVED_WEB_URL);

  miniWindow.on("blur", () => {
    if (miniWindow) {
      miniWindow.close();
      miniWindow = null;
    }
  });

  miniWindow.on("closed", () => {
    miniWindow = null;
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());

  const contextMenu = Menu.buildFromTemplate(createTrayMenuItems());

  tray.setToolTip("Personal AI Runtime");
  tray.setContextMenu(contextMenu);

  // Rebuild menu on click to reflect toggle state
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
    tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuItems()));
  });
  tray.on("right-click", () => {
    tray.setContextMenu(Menu.buildFromTemplate(createTrayMenuItems()));
  });
}

function createTrayMenuItems() {
  const autoLaunchEnabled = app.getLoginItemSettings().openAtLogin;
  return [
    {
      label: "打开 Personal AI Runtime",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    {
      label: "快捷对话 (Alt+Space)",
      click: () => createMiniWindow(),
    },
    { type: "separator" },
    {
      label: backendProcess ? "重启后端" : "启动后端",
      click: () => {
        void (async () => {
          await stopBackend();
          await startBackend();
        })();
      },
    },
    { type: "separator" },
    {
      label: autoLaunchEnabled ? "✓ 开机自启" : "开机自启",
      type: "checkbox",
      checked: autoLaunchEnabled,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
        });
      },
    },
    { type: "separator" },
    {
      label: "关于",
      click: () => {
        const statusText = backendProcess ? "后端运行中" : "后端未运行（需手动启动 backend）";
        dialog.showMessageBox({
          type: "info",
          title: "Personal AI Runtime",
          message: `Personal AI Runtime v${APP_VERSION}`,
          detail: `${statusText}\n数据存于本机，完全私有`,
        });
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function registerGlobalShortcuts() {
  globalShortcut.register("Alt+Space", () => {
    createMiniWindow();
  });

  globalShortcut.register("Alt+Shift+I", () => {
    quickCapture();
  });
}

async function quickCapture() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
  if (mainWindow) {
    mainWindow.webContents.executeJavaScript(`
      window.postMessage({ type: 'quick-capture' }, window.location.origin);
    `);
  }
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body });
    notification.show();
    notification.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createMainWindow();
      }
    });
  }
}

async function probeLiveBackend() {
  const url = `http://127.0.0.1:${BACKEND_PORT}/api/system/live`;
  try {
    const res = await electronNet.fetch(url);
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    return {
      ok: Boolean(res && res.ok && payload && payload.service === "personal-ai-runtime"),
      status: res && res.status,
      service: payload && payload.service,
    };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

async function finishDesktopSmoke(startStatus, backendReady) {
  const health = await probeLocalBackend();
  const live = await probeLiveBackend();
  const ok = startStatus !== "conflict"
    && startStatus !== "failed"
    && startStatus !== "busy"
    && backendReady === true
    && health.kind === "ours"
    && live.ok === true;
  writeSmokeResult(process.env, {
    ok,
    packaged: isPackaged,
    startStatus,
    backendReady,
    health: {
      kind: health.kind,
      status: health.status,
      service: health.payload && health.payload.service,
      version: health.payload && health.payload.version,
    },
    live,
    pid: process.pid,
    backendExitCode,
    backendLog: backendLog.trim().slice(-2000),
  });
  const started = Date.now();
  while (!smokeShouldStop(process.env, started, Date.now())) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  isQuitting = true;
  await stopBackend();
  app.exit(ok ? 0 : 1);
}

// ── App Lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Register custom protocol + API proxy before any window is created.
  registerAppProtocol();
  installApiProxy();

  const smoke = isDesktopSmokeMode();

  // First-run: ask for auto-launch consent (was previously forced).
  if (!smoke) {
    try {
      const settings = app.getLoginItemSettings();
      if (!settings.openAtLogin && !settings.wasOpenedAtLogin) {
        const result = await dialog.showMessageBox({
          type: "question",
          title: "Personal AI Runtime",
          message: "是否允许开机自启？",
          detail: "开机自启后，AI 可以在后台持续为你工作。你可以在托盘菜单中随时切换。",
          buttons: ["允许", "暂不"],
          defaultId: 0,
          cancelId: 1,
        });
        if (result.response === 0) {
          app.setLoginItemSettings({ openAtLogin: true });
        }
      }
    } catch {
      // login item settings not supported on this platform — skip silently
    }
  }

  // Auto-start backend and wait until health responds (migrations can take a while).
  const startStatus = await startBackend();
  let backendReady = false;
  if (startStatus !== "conflict") {
    backendReady = await waitForBackendReady(smoke ? 180000 : 90000);
    if (!backendReady && !smoke) {
      dialog.showMessageBox({
        type: "warning",
        title: "Personal AI Runtime",
        message: "后端启动较慢或失败",
        detail:
          "应用界面已打开，但暂时无法连接后端。请稍后在托盘菜单选择「重启后端」，或查看 README 中的安装说明。",
      });
    }
  }

  if (smoke) {
    await finishDesktopSmoke(startStatus, backendReady);
    return;
  }

  createMainWindow();
  createTray();
  registerGlobalShortcuts();
  connectWebSocket();

  app.on("activate", () => {
    if (mainWindow === null) {
      createMainWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray
});

let stoppingForQuit = false;

app.on("before-quit", (event) => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  disconnectWebSocket();
  if (backendProcess && !stoppingForQuit) {
    event.preventDefault();
    stoppingForQuit = true;
    void stopBackend().finally(() => {
      app.quit();
    });
  }
});

// ── WebSocket ────────────────────────────────────────────────────────

const wsReconnect = createWsReconnectPolicy({
  initialDelayMs: 1000,
  maxDelayMs: 60000,
});
let desktopWs = null;

function disconnectWebSocket() {
  wsReconnect.stop();
  if (!desktopWs) return;
  try {
    desktopWs.removeAllListeners();
    desktopWs.close();
  } catch {
    // already closed
  }
  desktopWs = null;
}

function connectWebSocket() {
  if (wsReconnect.isStopped()) return;
  try {
    const WebSocket = require("ws");
    const wsUrl = BACKEND_URL.replace(/^http/, "ws") + "/ws";
    const protocols = AUTH_TOKEN ? [`auth.${AUTH_TOKEN}`, "auth.ok"] : undefined;
    const ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
    desktopWs = ws;
    attachNotificationSocketHandlers(ws, {
      reconnect: wsReconnect,
      connect: connectWebSocket,
      onNotification: (event) => showNotification(event.title, event.content),
    });
  } catch {
    // WebSocket not available, skip
  }
}

// No renderer-facing IPC handlers: the renderer talks to the backend directly
// over HTTP/SSE/WebSocket, and desktop-native concerns (tray, global shortcuts,
// system notifications on WebSocket events) are handled in this main process.
