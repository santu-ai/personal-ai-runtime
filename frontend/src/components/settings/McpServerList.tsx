import type { KeyboardEvent } from "react";
import type { McpServerStatus } from "../../api/types";
import { isImeKeyboardEvent } from "../../utils/imeKey";
import Badge from "../ui/Badge";

/** 平时一行。键盘落到这一名称时写出整句。鼠标悬停仍是一行。 */
const revealOnFocus =
  "min-w-0 max-w-full truncate focus-visible:overflow-visible focus-visible:whitespace-normal focus-visible:text-clip focus-visible:break-words";

function keepBareKeysFromScrolling(event: KeyboardEvent<HTMLElement>) {
  if (isImeKeyboardEvent(event.nativeEvent)) return;
  if (event.key === "Enter" || event.key === " ") event.preventDefault();
}

type BadgeTone = "default" | "success" | "warning" | "danger" | "insight";

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "connected":
      return "success";
    case "lazy":
      return "insight";
    case "unavailable":
      return "warning";
    case "disconnected":
      return "danger";
    default:
      return "default";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "lazy":
      return "懒加载";
    case "unavailable":
      return "不可用";
    case "disconnected":
      return "未连接";
    case "disabled":
      return "已禁用";
    default:
      return status;
  }
}

function reasonLabel(reason?: string): string | null {
  if (!reason) return null;
  if (reason === "missing_env") return "缺少环境变量 / 凭证未配置";
  if (reason === "not_connected") return "尚未建立连接";
  if (reason === "transport_disconnected") return "传输层断开";
  return reason;
}

interface Props {
  servers: McpServerStatus[];
}

export default function McpServerList({ servers }: Props) {
  if (servers.length === 0) {
    return <p className="text-sm text-fg-tertiary">暂无 MCP 服务器</p>;
  }

  return (
    <ul className="mt-3 space-y-2">
      {servers.map((server) => {
        const reason = reasonLabel(server.reason);
        return (
          <li
            key={server.name}
            className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-surface-sunken/60 border border-border-subtle"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 flex-wrap">
                {server.name.trim() ? (
                  <span
                    tabIndex={0}
                    onKeyDown={keepBareKeysFromScrolling}
                    className={`rounded-sm text-sm font-medium text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${revealOnFocus}`}
                  >
                    {server.name}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-fg-primary">{server.name}</span>
                )}
                <Badge tone={statusTone(server.status)} dot className="shrink-0">
                  {statusLabel(server.status)}
                </Badge>
              </div>
              {reason && <p className="text-xs text-fg-tertiary mt-1 break-all">{reason}</p>}
            </div>
            <span className="text-xs text-fg-tertiary shrink-0 pt-0.5">
              {server.tool_count} 工具
            </span>
          </li>
        );
      })}
    </ul>
  );
}
