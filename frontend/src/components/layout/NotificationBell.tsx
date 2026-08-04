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
import NotificationDetailModal from "../notifications/NotificationDetailModal";
import { notificationPreview } from "../../utils/notificationUtils";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Notification | null>(null);
  const { data: notifications = [], refetch } = useNotificationsQuery(15);
  const invalidateNotifications = useInvalidateNotifications();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      // Use setTimeout to let the current event finish before attaching,
      // so the mousedown that opened the dropdown doesn't also close it.
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
      <div className="relative px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
            if (!open) void refetch();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label="通知"
        >
          <Bell size={18} />
          <span>通知</span>
          {unread > 0 && (
            <span className="ml-auto bg-insight text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
              {unread}
            </span>
          )}
        </button>

        {open && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full left-2 right-2 mb-1 bg-surface-raised border border-border-strong rounded-xl shadow-xl max-h-64 overflow-y-auto z-50"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
              <span className="text-xs text-fg-tertiary">最近通知</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-fg-secondary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                >
                  全部已读
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-xs text-fg-disabled p-4 text-center">暂无通知</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleOpenDetail(n)}
                  className={`w-full text-left p-3 hover:bg-surface-overlay border-b border-border-subtle last:border-0 ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  <p className={`text-sm ${n.read ? "text-fg-secondary" : "text-fg-primary"}`}>
                    {n.title}
                  </p>
                  <p className="text-xs text-fg-tertiary mt-1 line-clamp-2">
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
