import { useEffect, useState, Suspense } from "react";
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
import QuickCaptureDialog from "./components/quickcapture/QuickCaptureDialog";
import { LiveNotificationContext, useNotifications } from "./hooks/useNotifications";
import { useWsInvalidationBridge } from "./hooks/useWsInvalidationBridge";
import { useHeldQueryError } from "./components/ui/LoadErrorNotice";

export default function Layout() {
  const { conversations, activeConversationId, setActiveConversation } = useChatStore();
  const quickChat = useQuickChat();
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

  const handleNewChat = () => quickChat();

  const handleDeleteChat = (id: string) => {
    const conv = conversationRows.find((c) => c.id === id);
    setDeleteTarget({ id, title: conv?.title || "新对话" });
  };

  const confirmDeleteChat = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteConversation(id);
      removeConversationCached(id);
      if (activeConversationId === id) {
        navigate("/");
      }
    } catch (e) {
      addError(e instanceof ApiError ? e.message : "删除对话失败", "对话");
    }
  };

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
                tone="danger"
                title={err.source ? `[${err.source}] 错误` : "错误"}
                body={err.message}
                onDismiss={() => dismissError(err.id)}
              />
            ))}
            {toasts.map((t) => (
              <ToastCard
                key={t.id}
                tone="insight"
                title={t.title}
                body={t.content}
                onClick={() =>
                  setToastDetail({
                    id: t.id,
                    type: t.type,
                    title: t.title,
                    content: t.content,
                    created_at: t.created_at,
                  })
                }
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
          confirmLabel="删除"
          variant="danger"
          onConfirm={confirmDeleteChat}
          onCancel={() => setDeleteTarget(null)}
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
