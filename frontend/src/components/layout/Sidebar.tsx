import { NavLink, useLocation } from "react-router-dom";
import {
  MessageSquare,
  Target,
  Mail,
  Brain,
  BarChart3,
  Settings,
  ShieldCheck,
  Trash2,
  Clock,
  ListTodo,
  Plus,
} from "lucide-react";
import { useApprovalsQuery } from "../../hooks/useApprovalsQuery";
import { useInboxQuery } from "../../hooks/useInboxQuery";
import { useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";

const PRIMARY_NAV = [{ path: "/", label: "对话", icon: MessageSquare }];

const DATA_NAV = [
  { path: "/dashboard", label: "概览", icon: BarChart3, badgeKey: null },
  { path: "/goals", label: "目标", icon: Target, badgeKey: null },
  { path: "/tasks", label: "任务", icon: ListTodo, badgeKey: null },
  { path: "/inbox", label: "收件箱", icon: Mail, badgeKey: "inbox" as const },
  { path: "/approvals", label: "审批", icon: ShieldCheck, badgeKey: "approvals" as const },
  { path: "/memories", label: "记忆", icon: Brain, badgeKey: "memories" as const },
  { path: "/timeline", label: "时间线", icon: Clock, badgeKey: null },
];

const SYSTEM_NAV = [{ path: "/settings", label: "设置", icon: Settings }];

interface SidebarProps {
  conversations: Array<{ id: string; title: string; summary?: string | null }>;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  footer?: React.ReactNode;
}

function isChatRoute(pathname: string) {
  return pathname === "/" || pathname.startsWith("/chat/");
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto text-[10px] min-w-[1.25rem] h-5 px-1.5 rounded-full bg-warning/20 text-warning flex items-center justify-center font-medium">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default function Sidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteChat,
  footer,
}: SidebarProps) {
  const location = useLocation();
  const onChatPage = isChatRoute(location.pathname);
  const { data: approvals = [] } = useApprovalsQuery();
  const { data: inbox } = useInboxQuery();
  const { data: proposedCount = 0 } = useProposedMemoryCountQuery();
  const approvalCount = approvals.length;
  const inboxCount = inbox?.emails?.length ?? 0;

  const badgeFor = (key: "inbox" | "approvals" | "memories" | null) => {
    if (key === "approvals") return approvalCount;
    if (key === "inbox") return inboxCount;
    if (key === "memories") return proposedCount;
    return 0;
  };

  return (
    <aside className="w-64 bg-surface-raised border-r border-border-subtle flex flex-col shrink-0">
      <div className="p-4 border-b border-border-subtle">
        <h1 className="text-base font-semibold text-fg-primary leading-tight">Personal AI</h1>
        <p className="text-xs text-fg-tertiary mt-1">本地第二大脑</p>
      </div>

      <nav className="px-2 py-2 border-b border-border-subtle">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          const active = isChatRoute(location.pathname);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                active
                  ? "bg-surface-overlay text-fg-primary"
                  : "text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <nav className="px-2 py-2 border-b border-border-subtle overflow-y-auto shrink-0">
        <p className="px-3 py-1.5 text-[11px] text-fg-tertiary uppercase tracking-wide">我的数据</p>
        {DATA_NAV.map((item) => {
          const Icon = item.icon;
          const count = badgeFor(item.badgeKey);
          const to =
            item.badgeKey === "memories" && proposedCount > 0 ? "/memories?tab=review" : item.path;
          return (
            <NavLink
              key={item.path}
              to={to}
              className={({ isActive }) =>
                `w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm mb-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  isActive
                    ? "bg-surface-overlay text-fg-primary"
                    : "text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary"
                }`
              }
            >
              <Icon size={16} className="shrink-0" />
              <span>{item.label}</span>
              <NavBadge count={count} />
            </NavLink>
          );
        })}
      </nav>

      {onChatPage ? (
        <>
          <div className="px-2 pt-3 pb-1">
            <button
              type="button"
              onClick={onNewChat}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <Plus size={16} className="shrink-0" />
              新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer mb-1 transition-colors ${
                  activeConversationId === conv.id
                    ? "bg-surface-overlay text-fg-primary"
                    : "text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm block">{conv.title || "未命名"}</span>
                  {conv.summary && (
                    <span className="truncate text-xs text-fg-disabled block">{conv.summary}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChat(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-fg-tertiary hover:text-danger transition-all ml-2 shrink-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                  title="删除对话"
                  aria-label="删除对话"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="text-fg-disabled text-sm text-center mt-8">暂无对话</p>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div className="border-t border-border-subtle px-2 py-2 mt-auto">
        {SYSTEM_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  isActive
                    ? "bg-surface-overlay text-fg-primary"
                    : "text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary"
                }`
              }
            >
              <Icon size={18} className="shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>

      {footer}
    </aside>
  );
}
