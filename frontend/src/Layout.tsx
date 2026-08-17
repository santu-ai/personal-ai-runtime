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
import { useNotifications } from "./hooks/useNotifications";
import { useWsInvalidationBridge } from "./hooks/useWsInvalidationBridge";

export default function Layout() {
  const { conversations, activeConversationId, setActiveConversation } = useChatStore();
  const quickChat = useQuickChat();
  const { remove: removeConversationCached } = useConversationCacheActions();

  // Server-state: conversations + health (auth banner). WS bridge drives other keys.
  useConversationsQuery();
  const { data: health } = useSettingsHealthQuery();
  const authRequired = Boolean(health?.auth_required);

  const { toasts, dismissToast } = useNotifications();
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
    const conv = conversations.find((c) => c.id === id);
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
    <div className="flex h-screen bg-surface-base text-fg-primary">
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        footer={<NotificationBell />}
      />

      {authRequired && !isAuthConfigured() && (
        <div className="fixed top-0 left-64 right-0 z-50 px-4 py-2">
          <NoticeBanner
            tone="warning"
            title="后端已启用认证，请在 .env 中设置 VITE_AUTH_TOKEN（与 AUTH_TOKEN 保持一致）后重启前端"
            className="rounded-none border-x-0"
            testId="auth-banner"
          />
        </div>
      )}

      {backendUnavailable && (
        <div className="fixed top-0 left-64 right-0 z-50 px-4 py-2">
          <NoticeBanner
            tone="danger"
            title="无法连接到后端服务，请确认后端已启动"
            className="rounded-none border-x-0"
            testId="backend-banner"
          />
        </div>
      )}

      <div className="fixed bottom-20 right-4 z-50 space-y-2 max-w-sm" data-testid="notice-stack">
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

      <main className="flex-1 flex flex-col min-w-0">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-fg-secondary animate-pulse">
              加载中…
            </div>
          }
        >
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Suspense>
      </main>

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
  );
}
