import { useEffect, useLayoutEffect, useRef, useState, Suspense } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useChatStore } from "./stores/chatStore";
import { useErrorStore } from "./stores/errorStore";
import { deleteConversation, isAuthConfigured, ApiError, type Notification } from "./api/client";
import { useQuickChat } from "./hooks/useQuickChat";
import { useConversationsQuery, useConversationCacheActions } from "./hooks/useConversationsQuery";
import { useSettingsHealthQuery } from "./hooks/useSettingsQuery";
import Sidebar from "./components/layout/Sidebar";
import Dialog from "./components/ui/Dialog";
import NotificationBell from "./components/layout/NotificationBell";
import NotificationDetailModal from "./components/notifications/NotificationDetailModal";
import OnboardingWizard from "./components/onboarding/OnboardingWizard";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import NoticeBanner from "./components/ui/NoticeBanner";
import ToastCard from "./components/ui/ToastCard";
import { captureToastDismissFocus, placeToastDismissFocus } from "./utils/toastDismissFocus";
import QuickCaptureDialog from "./components/quickcapture/QuickCaptureDialog";
import {
  HomeConversationGateProvider,
  useHomeConversationGate,
} from "./components/chat/homeConversationGate";
import { LiveNotificationContext, useNotifications } from "./hooks/useNotifications";
import { useWsInvalidationBridge } from "./hooks/useWsInvalidationBridge";
import { useHeldQueryError } from "./components/ui/LoadErrorNotice";

/** 焦点在页面空白处。已经在别的控件上就不再抢。 */
function focusIsBlank(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return false;
}

function focusNewChat(): void {
  document.querySelector<HTMLButtonElement>("button[data-new-chat]")?.focus();
}

/** 绘制前通知。测试在删除确认框卸下的同一轮读取焦点。 */
export const layoutDeleteLayoutFocus = {
  notify: null as null | (() => void),
};

/** 绘制前通知。测试在右下角提示卸下的同一轮读取焦点。 */
export const toastStackLayoutFocus = {
  notify: null as null | (() => void),
};

type ChatDeleteHandoff = { id: string; nextId: string | null };

/** 焦点在页面空白处，或还停在刚删掉的那一行上。已经在别的控件上就不再抢。 */
function chatDeleteFocusIdle(id: string): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!(active instanceof HTMLElement) || !active.isConnected) return true;
  return active.getAttribute("data-conversation-delete") === id;
}

function focusConversationDelete(id: string): boolean {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const node = document.querySelector<HTMLButtonElement>(
    `button[data-conversation-delete="${escaped}"]`,
  );
  if (!node || node.disabled) return false;
  node.focus();
  return document.activeElement === node;
}

function neighborId(rows: readonly { id: string }[], id: string): string | null {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
}

export default function Layout() {
  return (
    <HomeConversationGateProvider>
      <LayoutFrame />
    </HomeConversationGateProvider>
  );
}

function LayoutFrame() {
  const { conversations, activeConversationId, setActiveConversation } = useChatStore();
  const quickChat = useQuickChat();
  const conversationGate = useHomeConversationGate();
  const [openingChat, setOpeningChat] = useState(false);
  const chatFailFocus = useRef(false);
  const { remove: removeConversationCached } = useConversationCacheActions();

  // Server-state: conversations + health (auth banner). WS bridge drives other keys.
  const conversationsQuery = useConversationsQuery();
  const conversationRows = conversationsQuery.data ?? conversations;
  const shownConversationError = useHeldQueryError(
    conversationsQuery.data !== undefined || conversationRows.length > 0,
    conversationsQuery.error,
    conversationsQuery.isFetching,
    "加载对话失败",
    "sidebar-conversations",
  );
  const { data: health } = useSettingsHealthQuery();
  const authRequired = Boolean(health?.auth_required);

  const { toasts, liveNotifications, dismissToast } = useNotifications();
  useWsInvalidationBridge();
  const { errors, dismissError, backendUnavailable, addError } = useErrorStore();
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const deleteHandoff = useRef<ChatDeleteHandoff | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem("onboarding_done"),
  );
  const [toastDetail, setToastDetail] = useState<Notification | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const match = location.pathname.match(/^\/chat\/([^/]+)/);
    const convId = match?.[1] ?? null;
    if (convId && convId !== activeConversationId) {
      setActiveConversation(convId);
    } else if (location.pathname === "/" && activeConversationId) {
      setActiveConversation(null);
    }
  }, [location.pathname, activeConversationId, setActiveConversation]);

  const handleNewChat = () => {
    // 和首页「发送」「开始对话」共用一把锁。那边还没创建回来时，这里不再开一份。
    if (!conversationGate.tryHold()) return;
    chatFailFocus.current = false;
    setOpeningChat(true);
    void (async () => {
      let ok = false;
      try {
        ok = (await quickChat()) === true;
      } finally {
        conversationGate.release();
        if (!ok) chatFailFocus.current = true;
        setOpeningChat(false);
      }
    })();
  };

  useLayoutEffect(() => {
    if (openingChat) return;
    if (!chatFailFocus.current) return;
    chatFailFocus.current = false;
    if (focusIsBlank()) focusNewChat();
  }, [openingChat]);

  const handleDeleteChat = (id: string) => {
    const conv = conversationRows.find((c) => c.id === id);
    setDeleteTarget({ id, title: conv?.title || "新对话" });
  };

  const confirmDeleteChat = async () => {
    if (!deleteTarget || deletingRef.current) return;
    const { id } = deleteTarget;
    const nextId = neighborId(conversationRows, id);
    deletingRef.current = true;
    deleteHandoff.current = null;
    setDeleting(true);
    let removed = false;
    try {
      await deleteConversation(id);
      setDeleteTarget(null);
      removeConversationCached(id);
      removed = true;
      if (activeConversationId === id) {
        navigate("/");
      }
    } catch (e) {
      addError(e instanceof ApiError ? e.message : "删除对话失败", "对话");
    } finally {
      if (removed) deleteHandoff.current = { id, nextId };
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  // 确认框卸下的同一轮就把焦点交到下一行。放到绘制前，不把焦点留在页面空白。
  useLayoutEffect(() => {
    if (deleting) return;
    const pending = deleteHandoff.current;
    if (!pending) return;
    deleteHandoff.current = null;
    if (!chatDeleteFocusIdle(pending.id)) return;
    if (pending.nextId && focusConversationDelete(pending.nextId)) return;
    focusNewChat();
  }, [deleting, conversationRows]);

  // 提示卸下的同一轮就把焦点交出去。放到绘制前，不把焦点留在页面空白。
  useLayoutEffect(() => {
    placeToastDismissFocus();
  });

  useLayoutEffect(() => {
    layoutDeleteLayoutFocus.notify?.();
    toastStackLayoutFocus.notify?.();
  });

  const handleSelectConversation = (id: string) => {
    setActiveConversation(id);
    navigate(`/chat/${id}`);
  };

  return (
    <LiveNotificationContext.Provider value={liveNotifications}>
      <div className="flex h-screen bg-surface-app text-fg-primary font-sans">
        <Sidebar
          conversations={conversationRows}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          newChatBusy={openingChat}
          onDeleteChat={handleDeleteChat}
          conversationsLoadError={conversationRows.length > 0 ? null : shownConversationError}
          conversationsLoadBusy={conversationsQuery.isFetching}
          conversationsLoadPending={
            conversationRows.length === 0 &&
            conversationsQuery.data === undefined &&
            conversationsQuery.isPending &&
            !shownConversationError
          }
          onRetryConversations={() => void conversationsQuery.refetch()}
          footer={<NotificationBell />}
        />

        <div className="relative flex min-w-0 flex-1 flex-col">
          {authRequired && !isAuthConfigured() && (
            <div className="absolute inset-x-0 top-0 z-50 px-3 pt-2">
              <NoticeBanner
                tone="warning"
                title="后端已启用认证，请在 .env 中设置 VITE_AUTH_TOKEN（与 AUTH_TOKEN 保持一致）后重启前端"
                testId="auth-banner"
              />
            </div>
          )}

          {backendUnavailable && (
            <div className="absolute inset-x-0 top-0 z-50 px-3 pt-2">
              <NoticeBanner
                tone="danger"
                title="无法连接到后端服务，请确认后端已启动"
                testId="backend-banner"
              />
            </div>
          )}

          <div
            className="fixed bottom-20 right-4 z-50 max-w-sm space-y-2"
            data-testid="notice-stack"
          >
            {errors.map((err) => (
              <ToastCard
                key={err.id}
                toastId={err.id}
                tone="danger"
                title={err.source ? `[${err.source}] 错误` : "错误"}
                body={err.message}
                onDismiss={() => {
                  captureToastDismissFocus(err.id);
                  dismissError(err.id);
                }}
              />
            ))}
            {toasts.map((t) => (
              <ToastCard
                key={t.id}
                toastId={t.id}
                tone="insight"
                title={t.title}
                body={t.content}
                onClick={() => {
                  // 详情关掉时这条提示也卸下。返回目标记成铃，焦点才不会落到已经不在的提示上。
                  document.querySelector<HTMLElement>("[data-notification-bell]")?.focus();
                  setToastDetail({
                    id: t.id,
                    type: t.type,
                    title: t.title,
                    content: t.content,
                    created_at: t.created_at,
                  });
                }}
                onDismiss={() => dismissToast(t.id)}
              />
            ))}
          </div>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-app">
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center text-fg-secondary animate-pulse">
                  加载中…
                </div>
              }
            >
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </Suspense>
          </main>
        </div>

        <Dialog
          open={!!deleteTarget}
          title="删除对话"
          description={
            deleteTarget ? `确定删除对话「${deleteTarget.title}」？此操作不可撤销。` : undefined
          }
          confirmLabel={deleting ? "删除中..." : "删除"}
          variant="danger"
          confirmBusy={deleting}
          onConfirm={() => void confirmDeleteChat()}
          onCancel={() => {
            if (deletingRef.current) return;
            setDeleteTarget(null);
          }}
        />

        {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}

        <NotificationDetailModal
          notification={toastDetail}
          onClose={() => {
            if (toastDetail) dismissToast(toastDetail.id);
            setToastDetail(null);
          }}
        />

        <QuickCaptureDialog />
      </div>
    </LiveNotificationContext.Provider>
  );
}
