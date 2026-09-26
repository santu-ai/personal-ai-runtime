import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getAuthToken } from "../api/client";
import { captureToastDismissFocus } from "../utils/toastDismissFocus";
import { dispatchWsEvent } from "./useWsInvalidationBridge";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content: string;
  created_at: string;
  read?: number;
  /** server = HTTP pull; live = optimistic WebSocket push */
  source?: "server" | "live";
}

// Type guard for WebSocket notification payload
interface WSNotificationPayload {
  type: string;
  id?: string;
  title?: string;
  content?: string;
  created_at?: string;
  notification_type?: string;
}

function isValidNotification(data: unknown): data is WSNotificationPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as Record<string, unknown>)["type"] === "string"
  );
}

function buildWsUrl(): string {
  const isDesktop =
    import.meta.env.VITE_DESKTOP === "1" ||
    import.meta.env.VITE_DESKTOP === true ||
    (typeof window !== "undefined" && window.location.protocol === "app:");
  if (typeof window !== "undefined" && !isDesktop) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  return `ws://${__API_HOST__}:${__API_PORT__}/ws`;
}

function buildWsProtocols(): string[] | undefined {
  const token = getAuthToken();
  // Request auth token for server validation; also offer auth.ok for negotiated response.
  return token ? [`auth.${token}`, "auth.ok"] : undefined;
}

const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 60_000;

export const LiveNotificationContext = createContext<NotificationItem[]>([]);

export function useLiveNotifications(): NotificationItem[] {
  return useContext(LiveNotificationContext);
}

function reconnectDelayMs(attempt: number): number {
  return Math.min(MAX_RECONNECT_MS, INITIAL_RECONNECT_MS * 2 ** Math.max(0, attempt));
}

export function useNotifications() {
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [liveNotifications, setLiveNotifications] = useState<NotificationItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    // 到点自己关掉时，焦点若还在这条上，先记下来，页面才能在卸下的同一轮交出去。
    captureToastDismissFocus(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Stable ref for dismissToast to avoid unnecessary reconnects
  const dismissToastRef = useRef(dismissToast);
  dismissToastRef.current = dismissToast;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;

    const clearTimer = () => {
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== undefined) return;
      const delay = reconnectDelayMs(attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (stopped) return;
      clearTimer();
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        const protocols = buildWsProtocols();
        ws = protocols ? new WebSocket(buildWsUrl(), protocols) : new WebSocket(buildWsUrl());

        ws.onmessage = (event) => {
          try {
            const raw = JSON.parse(event.data);
            if (!isValidNotification(raw)) return;

            // Forward every well-formed WS payload to the invalidation hub
            // so non-notification events (e.g. memory_changed) can drive
            // cache refreshes without polling.
            dispatchWsEvent(raw);

            if (raw.type !== "notification") return;

            const category =
              typeof raw.notification_type === "string" && raw.notification_type
                ? raw.notification_type
                : "notification";

            const item: NotificationItem = {
              id: raw.id || `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              type: category,
              title: raw.title || "通知",
              content: raw.content || "",
              created_at: raw.created_at || new Date().toISOString(),
              source: "live",
            };

            setLiveNotifications((prev) => [item, ...prev].slice(0, 20));
            setToasts((prev) => [item, ...prev].slice(0, 3));

            setTimeout(() => {
              dismissToastRef.current(item.id);
            }, 8000);
          } catch {
            // ignore malformed messages
          }
        };

        ws.onopen = () => {
          attempt = 0;
        };

        ws.onerror = () => {
          // onclose uniquely schedules reconnection
        };

        ws.onclose = () => {
          ws = null;
          if (!stopped) scheduleReconnect();
        };
      } catch {
        if (!stopped) scheduleReconnect();
      }
    };

    const reconnectNow = () => {
      if (stopped) return;
      clearTimer();
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      connect();
    };

    const onOnline = () => reconnectNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };

    connect();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearTimer();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, []);

  return { toasts, liveNotifications, dismissToast };
}
