import { Zap } from "lucide-react";
import { type Notification } from "../../api/client";
import { notificationPreview } from "../../utils/notificationUtils";

interface RemindersPanelProps {
  notifications: Array<Notification & { source?: "server" | "live" }>;
  onNotificationClick: (n: Notification & { source?: "server" | "live" }) => void;
}

export default function RemindersPanel({
  notifications,
  onNotificationClick,
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
              className={`w-full text-left p-3 bg-surface-overlay/50 rounded-lg hover:bg-surface-overlay transition-colors ${
                n.read ? "opacity-60" : ""
              }`}
            >
              <div className={`text-sm ${n.read ? "text-fg-secondary" : "text-fg-primary"}`}>
                {n.title}
              </div>
              <div className="text-xs text-fg-tertiary mt-1 line-clamp-2">
                {notificationPreview(n.content)}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-fg-disabled text-sm text-center py-4">暂无提醒</p>
      )}
    </div>
  );
}
