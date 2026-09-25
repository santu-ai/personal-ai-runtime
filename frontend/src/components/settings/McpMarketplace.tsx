import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { installMcpConnector } from "../../api/connectors";
import { useErrorStore } from "../../stores/errorStore";
import { useMcpRegistryQuery } from "../../hooks/useSettingsQuery";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";

const CATEGORIES: Record<string, string> = {
  browser: "浏览器",
  search: "搜索",
  developer: "开发者",
  productivity: "效率",
  system: "系统",
  ai: "AI",
  communication: "通讯",
};

/** 焦点在页面空白处，或还停在这次点的安装按钮上，才可以把焦点挪走。 */
function focusIsIdle(name: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("data-mcp-install") === name;
}

function focusNeighborInstall(name: string): boolean {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-mcp-install]")];
  const index = buttons.findIndex((button) => button.getAttribute("data-mcp-install") === name);
  const tryFocus = (node: HTMLButtonElement | undefined) => {
    if (!node || node.disabled) return false;
    node.focus();
    return document.activeElement === node;
  };
  if (index < 0) return false;
  for (let i = index + 1; i < buttons.length; i += 1) {
    if (tryFocus(buttons[i])) return true;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (tryFocus(buttons[i])) return true;
  }
  return false;
}

export default function McpMarketplace() {
  const addError = useErrorStore((s) => s.addError);
  const { data, isLoading, error, isFetching, refetch } = useMcpRegistryQuery();
  const servers = data ?? [];
  const shownError = useHeldQueryError(
    data !== undefined,
    error,
    isFetching,
    "加载 MCP 市场失败",
    "mcp-registry",
  );
  const [installing, setInstalling] = useState<string | null>(null);
  const [installedExtra, setInstalledExtra] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);
  const installedExtraRef = useRef(installedExtra);
  const focusAfter = useRef<string | null>(null);
  installedExtraRef.current = installedExtra;

  useEffect(() => {
    if (error) {
      addError(queryErrorMessage(error, "加载 MCP 市场失败"), "设置");
    }
  }, [error, addError]);

  // 这一行写成「已安装」的同一轮就挪走焦点。放到绘制之后，观察 DOM 的那一轮还停在已经禁用的按钮上。
  useLayoutEffect(() => {
    const name = focusAfter.current;
    if (!name || installing) return;
    focusAfter.current = null;
    if (!focusIsIdle(name)) return;
    if (focusNeighborInstall(name)) return;
    document.querySelector<HTMLElement>("[data-mcp-install-notice]")?.focus();
  }, [installing, notice, installedExtra]);

  const handleInstall = async (name: string) => {
    if (busyRef.current) return;
    const row = servers.find((server) => server.name === name);
    if (!row || row.installed || installedExtraRef.current.has(name)) return;
    busyRef.current = true;
    setInstalling(name);
    setNotice(null);
    try {
      const result = await installMcpConnector(name);
      if (!result.ok) {
        addError(result.message.trim() || "安装失败", "设置");
        return;
      }
      const next = new Set(installedExtraRef.current);
      next.add(name);
      installedExtraRef.current = next;
      setInstalledExtra(next);
      setNotice(`"${name}" 已安装。重启后端后生效。`);
      focusAfter.current = name;
    } catch (installError) {
      addError(queryErrorMessage(installError, "安装失败"), "设置");
    } finally {
      busyRef.current = false;
      setInstalling(null);
    }
  };

  if (shownError) {
    return (
      <LoadErrorNotice
        message={shownError}
        busy={isFetching}
        onRetry={() => void refetch()}
        testId="mcp-registry-load-error"
      />
    );
  }

  if (isLoading || data === undefined) {
    return <p className="text-xs text-fg-disabled">加载市场中…</p>;
  }

  return (
    <div className="space-y-2 max-h-60 overflow-y-auto">
      {notice ? (
        <p
          className="text-xs text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          role="status"
          tabIndex={-1}
          data-mcp-install-notice
          data-testid="mcp-install-notice"
        >
          {notice}
        </p>
      ) : null}
      {servers.length === 0 ? (
        <p className="text-xs text-fg-disabled">暂无可用 MCP 服务器</p>
      ) : (
        servers.map((s) => {
          const installed = s.installed || installedExtra.has(s.name);
          const busy = installing === s.name;
          return (
            <div
              key={s.name}
              className="flex items-center justify-between bg-surface-overlay/50 rounded-lg p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-fg-primary">{s.name}</span>
                  <span className="text-xs px-1.5 py-0.5 bg-surface-overlay rounded text-fg-tertiary">
                    {CATEGORIES[s.category] || s.category}
                  </span>
                </div>
                <p className="text-xs text-fg-disabled mt-0.5 truncate">{s.description}</p>
                {Object.keys(s.env_vars || {}).length > 0 && (
                  <p className="text-xs text-fg-disabled mt-0.5">
                    需要: {Object.keys(s.env_vars).join(", ")}
                  </p>
                )}
              </div>
              <button
                type="button"
                data-mcp-install={s.name}
                onClick={() => void handleInstall(s.name)}
                disabled={installed}
                aria-busy={busy || undefined}
                className={
                  installed
                    ? "shrink-0 ml-3 px-3 py-1 text-xs bg-surface-overlay text-fg-disabled rounded cursor-not-allowed"
                    : `shrink-0 ml-3 px-3 py-1 text-xs bg-surface-overlay hover:bg-border-strong text-fg-primary rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                        busy ? " opacity-50" : ""
                      }`
                }
              >
                {busy ? "安装中…" : installed ? "已安装" : "安装"}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
