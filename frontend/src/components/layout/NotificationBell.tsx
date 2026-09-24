import { useState, useRef, useEffect } from "react";
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
import { useErrorStore } from "../../stores/errorStore";
import NotificationDetailModal from "../notifications/NotificationDetailModal";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";
import { notificationPreview } from "../../utils/notificationUtils";

interface Props {
  /** Icon-only mode when the sidebar is collapsed. */
  compact?: boolean;
}

export default function NotificationBell({ compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Notification | null>(null);
  const notificationsQuery = useNotificationsQuery(15);
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

  const unread = notifications.filter((n) => !n.read).length;

  const handleOpenDetail = async (n: Notification) => {
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
    try {
      await markAllNotificationsRead();
      invalidateNotifications();
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div className="relative px-2 pb-2" ref={dropdownRef}>
        <button
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
            className={`absolute bottom-full mb-1 bg-surface-raised border border-border-subtle rounded-lg shadow-overlay max-h-72 overflow-y-auto z-50 ${
              compact ? "left-0 w-72" : "left-2 right-2"
            }`}
            role="dialog"
            aria-label="最近通知"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle sticky top-0 bg-surface-raised">
              <span className="text-xs font-medium text-fg-tertiary">最近通知</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-fg-secondary hover:text-fg-primary rounded-md px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
                  onClick={() => handleOpenDetail(n)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-surface-hover border-b border-border-subtle last:border-0 transition-colors ${
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
