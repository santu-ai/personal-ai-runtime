import { useState } from "react";
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
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Clock,
  ListTodo,
} from "lucide-react";
import { useApprovalsQuery } from "../../hooks/useApprovalsQuery";
import { useInboxQuery } from "../../hooks/useInboxQuery";
import { useMemoriesGroupedQuery } from "../../hooks/useMemoriesQuery";

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

function isDataRoute(pathname: string) {
  return DATA_NAV.some((item) => pathname.startsWith(item.path));
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
  const [dataExpanded, setDataExpanded] = useState(isDataRoute(location.pathname));
  const { data: approvals = [] } = useApprovalsQuery();
  const { data: inbox } = useInboxQuery();
  const { data: proposedMemories } = useMemoriesGroupedQuery("proposed");
  const approvalCount = approvals.length;
  const inboxCount = inbox?.emails?.length ?? 0;
  const proposedCount = proposedMemories?.memories?.length ?? 0;

  const badgeFor = (key: "inbox" | "approvals" | "memories" | null) => {
    if (key === "approvals") return approvalCount;
    if (key === "inbox") return inboxCount;
    if (key === "memories") return proposedCount;
    return 0;
  };

  return (
    <aside className="w-64 bg-surface-raised border-r border-border-subtle flex flex-col shrink-0">
      <div className="p-4 border-b border-border-subtle">
        <h1 className="text-lg font-bold text-fg-primary">Personal AI Runtime</h1>
        <p className="text-xs text-fg-tertiary mt-1">你的第二大脑</p>
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

        {/* Always-visible decision shortcuts when something needs attention */}
        {(approvalCount > 0 || inboxCount > 0 || proposedCount > 0) && (
          <div className="mt-1 space-y-0.5">
            {approvalCount > 0 && (
              <NavLink
                to="/approvals"
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-warning hover:bg-warning/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <ShieldCheck size={14} className="shrink-0" />
                <span>待审批</span>
                <NavBadge count={approvalCount} />
              </NavLink>
            )}
            {proposedCount > 0 && (
              <NavLink
                to="/memories?tab=review"
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-insight hover:bg-insight/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <Brain size={14} className="shrink-0" />
                <span>待确认记忆</span>
                <NavBadge count={proposedCount} />
              </NavLink>
            )}
            {inboxCount > 0 && (
              <NavLink
                to="/inbox"
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-insight hover:bg-insight/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <Mail size={14} className="shrink-0" />
                <span>待处理邮件</span>
                <NavBadge count={inboxCount} />
              </NavLink>
            )}
          </div>
        )}
      </nav>

      {onChatPage && (
        <>
          <button
            onClick={onNewChat}
            className="mx-3 mt-3 px-4 py-2 bg-surface-overlay hover:bg-border-strong text-white rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            + 新对话
          </button>

          <div className="flex-1 overflow-y-auto mt-3 px-2">
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
                  <span className="truncate text-sm block">{conv.title || "新对话"}</span>
                  {conv.summary && (
                    <span className="truncate text-xs text-fg-disabled block">{conv.summary}</span>
                  )}
                </div>
                <button
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
      )}

      {!onChatPage && (
        <div className="px-2 py-2 flex-1 overflow-y-auto">
          <button
            onClick={() => setDataExpanded(!dataExpanded)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-fg-tertiary hover:text-fg-secondary transition-colors uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
          >
            {dataExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FolderOpen size={14} />
            <span>我的数据</span>
          </button>
          {dataExpanded && (
            <div className="mt-1">
              {DATA_NAV.map((item) => {
                const Icon = item.icon;
                const count = badgeFor(item.badgeKey);
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                        isActive
                          ? "bg-surface-overlay text-fg-primary"
                          : "text-fg-secondary hover:bg-surface-overlay/50 hover:text-fg-primary"
                      }`
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    <span>{item.label}</span>
                    <NavBadge count={count} />
                  </NavLink>
                );
              })}
            </div>
          )}
        </div>
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
