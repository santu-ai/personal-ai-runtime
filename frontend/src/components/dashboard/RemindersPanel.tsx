import { Zap } from "lucide-react";
import { type Notification } from "../../api/client";
import { notificationPreview } from "../../utils/notificationUtils";
import LoadErrorNotice from "../ui/LoadErrorNotice";

interface RemindersPanelProps {
  notifications: Array<Notification & { source?: "server" | "live" }>;
  onNotificationClick: (n: Notification & { source?: "server" | "live" }) => void;
  loadError?: string | null;
  loadBusy?: boolean;
  loadPending?: boolean;
  onRetry?: () => void;
  autoFocusRetry?: boolean;
}

export default function RemindersPanel({
  notifications,
  onNotificationClick,
  loadError = null,
  loadBusy = false,
  loadPending = false,
  onRetry,
  autoFocusRetry = false,
}: RemindersPanelProps) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={15} className="text-warning" />
        <h3 className="text-sm font-medium text-fg-secondary">AI 给你的提醒</h3>
      </div>
      {notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void onNotificationClick(n)}
              className={`group w-full text-left p-3 bg-surface-overlay/50 rounded-lg hover:bg-surface-overlay transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                n.read ? "opacity-60" : ""
              }`}
            >
              <div className={`text-sm ${n.read ? "text-fg-secondary" : "text-fg-primary"}`}>
                {n.title}
              </div>
              {/* 正文平时最多两行。键盘落到这一条时写出整段。鼠标悬停仍是两行。 */}
              <div className="mt-1 line-clamp-2 text-xs text-fg-tertiary group-focus-visible:line-clamp-none group-focus-visible:break-words">
                {notificationPreview(n.content)}
              </div>
            </button>
          ))}
        </div>
      ) : loadError ? (
        <LoadErrorNotice
          message={loadError}
          busy={loadBusy}
          onRetry={() => onRetry?.()}
          testId="today-reminders-load-error"
          autoFocus={autoFocusRetry}
        />
      ) : loadPending ? (
        <p className="text-fg-tertiary text-sm text-center py-4">加载中...</p>
      ) : (
        <p className="text-fg-disabled text-sm text-center py-4">暂无提醒</p>
      )}
    </div>
  );
}
