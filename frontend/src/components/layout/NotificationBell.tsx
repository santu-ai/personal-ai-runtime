import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "../../api/client";
import {
  useNotificationsQuery,
  useInvalidateNotifications,
} from "../../hooks/useNotificationsQuery";
import { queryKeys } from "../../hooks/useWsInvalidationBridge";
import { useErrorStore } from "../../stores/errorStore";
import NotificationDetailModal from "../notifications/NotificationDetailModal";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";
import { notificationPreview } from "../../utils/notificationUtils";

const NOTIFICATION_LIST_LIMIT = 15;

type MarkAllHandoff = "rows" | "panel";

/** 焦点在页面空白处，或还停在「全部已读」上，才可以把焦点挪走。 */
function focusIsIdle(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  return (
    active instanceof HTMLButtonElement &&
    active.getAttribute("data-notification-action") === "mark-all"
  );
}

function focusFirstNotification(panel: HTMLElement | null): boolean {
  const row = panel?.querySelector<HTMLButtonElement>("button[data-notification-row]");
  if (!row) return false;
  row.focus();
  return document.activeElement === row;
}

const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function canTabTo(node: HTMLElement): boolean {
  if (node.tabIndex < 0) return false;
  if (node.hasAttribute("disabled")) return false;
  if (node instanceof HTMLInputElement && node.type === "hidden") return false;
  if (node.closest("[hidden], [aria-hidden='true']")) return false;
  return true;
}

/** 下拉里按顺序可以 Tab 到的控件。禁用、隐藏和 tabindex=-1 跳过。 */
function tabbableNodes(panel: HTMLElement): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const items: HTMLElement[] = [];
  for (const node of panel.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
    if (seen.has(node)) continue;
    seen.add(node);
    if (!canTabTo(node)) continue;
    items.push(node);
  }
  return items;
}

function moveTab(panel: HTMLElement, shiftKey: boolean) {
  const items = tabbableNodes(panel);
  if (items.length === 0) {
    if (document.activeElement !== panel) panel.focus();
    return;
  }
  const active = document.activeElement;
  const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const next = shiftKey
    ? index <= 0
      ? items[items.length - 1]
      : items[index - 1]
    : index < 0 || index >= items.length - 1
      ? items[0]
      : items[index + 1];
  if (document.activeElement !== next) next.focus();
}

interface Props {
  /** Icon-only mode when the sidebar is collapsed. */
  compact?: boolean;
}

export default function NotificationBell({ compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const queryClient = useQueryClient();
  const markAllLock = useRef(false);
  const focusAfter = useRef<MarkAllHandoff | null>(null);
  const notificationsQuery = useNotificationsQuery(NOTIFICATION_LIST_LIMIT);
  const notifications = notificationsQuery.data ?? [];
  const refetch = notificationsQuery.refetch;
  const addError = useErrorStore((s) => s.addError);
  const shownError = useHeldQueryError(
    notificationsQuery.data !== undefined,
    notificationsQuery.error,
    notificationsQuery.isFetching,
    "加载通知失败",
    "notification-bell",
  );
  const invalidateNotifications = useInvalidateNotifications();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notificationsQuery.error) return;
    addError(queryErrorMessage(notificationsQuery.error, "加载通知失败"), "通知");
  }, [notificationsQuery.error, addError]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      const t = setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(t);
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const active = document.activeElement;
    // 失败「重试」已经在面板里时不抢走。
    if (panel && !(active instanceof Node && panel.contains(active))) {
      panel.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const current = panelRef.current;
        if (!current) return;
        event.preventDefault();
        moveTab(current, event.shiftKey);
        return;
      }
      // 组字时的 Esc 交给输入法。拦住的话，这一下会把下拉关掉。
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      setOpen(false);
      bellRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const pending = focusAfter.current;
    if (!pending || markingAll) return;
    focusAfter.current = null;
    if (!open || !focusIsIdle()) return;
    if (pending === "rows" && focusFirstNotification(panelRef.current)) return;
    panelRef.current?.focus();
  }, [markingAll, notifications, open]);

  const unread = notifications.filter((n) => !n.read).length;

  const handleOpenDetail = async (n: Notification) => {
    // 列表行会随下拉一起卸下。先把焦点放回铃，详情关闭时才能回到这里。
    bellRef.current?.focus();
    setOpen(false);
    setSelected(n);
    if (!n.read) {
      try {
        await markNotificationRead(n.id);
        invalidateNotifications();
        setSelected((prev) => (prev?.id === n.id ? { ...prev, read: 1 } : prev));
      } catch {
        // still show detail
      }
    }
  };

  const handleMarkAllRead = async () => {
    if (markAllLock.current) return;
    markAllLock.current = true;
    focusAfter.current = null;
    setMarkingAll(true);
    let handoff: MarkAllHandoff | null = null;
    try {
      await markAllNotificationsRead();
      try {
        await invalidateNotifications();
      } catch {
        // 列表没刷新仍走读取失败的提示，不把已经标上的已读说成失败。
      }
      const rows = queryClient.getQueryData<Notification[]>([
        ...queryKeys.notifications,
        NOTIFICATION_LIST_LIMIT,
      ]);
      if (rows && rows.every((row) => Boolean(row.read))) {
        handoff = rows.length > 0 ? "rows" : "panel";
      }
    } catch (error: unknown) {
      addError(queryErrorMessage(error, "标记已读失败"), "通知");
    } finally {
      focusAfter.current = handoff;
      markAllLock.current = false;
      setMarkingAll(false);
    }
  };

  return (
    <>
      <div className="relative px-2 pb-2" ref={dropdownRef}>
        <button
          ref={bellRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setOpen((wasOpen) => {
              if (!wasOpen) void refetch();
              return !wasOpen;
            });
          }}
          className={`nav-item nav-item-idle ${compact ? "justify-center px-0" : ""}`}
          aria-label="通知"
          title={compact ? "通知" : undefined}
        >
          <span className="relative">
            <Bell size={16} strokeWidth={1.75} />
            {compact && unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-insight" />
            )}
          </span>
          {!compact && (
            <>
              <span>通知</span>
              {unread > 0 && (
                <span className="ml-auto bg-insight text-fg-on-accent text-[10px] font-medium px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </>
          )}
        </button>

        {open && (
          <div
            ref={panelRef}
            tabIndex={-1}
            className={`absolute bottom-full mb-1 bg-surface-raised border border-border-subtle rounded-lg shadow-overlay max-h-72 overflow-y-auto z-50 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              compact ? "left-0 w-72" : "left-2 right-2"
            }`}
            role="dialog"
            aria-label="最近通知"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle sticky top-0 bg-surface-raised">
              <span className="text-xs font-medium text-fg-tertiary">最近通知</span>
              {(unread > 0 || markingAll) && (
                <button
                  type="button"
                  data-notification-action="mark-all"
                  aria-busy={markingAll || undefined}
                  onClick={() => void handleMarkAllRead()}
                  className={`text-xs text-fg-secondary hover:text-fg-primary rounded-md px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring${
                    markingAll ? " opacity-50" : ""
                  }`}
                >
                  全部已读
                </button>
              )}
            </div>
            {shownError ? (
              <div className="p-3">
                <LoadErrorNotice
                  message={shownError}
                  busy={notificationsQuery.isFetching}
                  onRetry={() => void refetch()}
                  testId="notifications-load-error"
                />
              </div>
            ) : notificationsQuery.isPending && notificationsQuery.data === undefined ? (
              <p className="text-xs text-fg-disabled p-4 text-center">加载中…</p>
            ) : notifications.length === 0 ? (
              <p className="text-xs text-fg-disabled p-4 text-center">暂无通知</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  data-notification-row={n.id}
                  onClick={() => handleOpenDetail(n)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-surface-hover border-b border-border-subtle last:border-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  <p className={`text-sm ${n.read ? "text-fg-secondary" : "text-fg-primary"}`}>
                    {n.title}
                  </p>
                  <p className="text-xs text-fg-tertiary mt-0.5 line-clamp-2">
                    {notificationPreview(n.content)}
                  </p>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <NotificationDetailModal notification={selected} onClose={() => setSelected(null)} />
    </>
  );
}
