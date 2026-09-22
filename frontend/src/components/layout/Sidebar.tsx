import { useEffect, useState, cloneElement, isValidElement } from "react";
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
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useApprovalsQuery } from "../../hooks/useApprovalsQuery";
import { useInboxQuery } from "../../hooks/useInboxQuery";
import { useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";

type BadgeKey = "inbox" | "approvals" | "memories" | null;

interface NavItem {
  path: string;
  label: string;
  icon: typeof MessageSquare;
  badgeKey?: BadgeKey;
  /** Match chat routes for the primary conversation entry. */
  chatActive?: boolean;
}

const OVERVIEW_NAV: NavItem[] = [
  { path: "/", label: "对话", icon: MessageSquare, chatActive: true },
  { path: "/dashboard", label: "概览", icon: BarChart3 },
];

const WORK_NAV: NavItem[] = [
  { path: "/goals", label: "目标", icon: Target },
  { path: "/tasks", label: "任务", icon: ListTodo },
  { path: "/inbox", label: "收件箱", icon: Mail, badgeKey: "inbox" },
  { path: "/approvals", label: "审批", icon: ShieldCheck, badgeKey: "approvals" },
];

const KNOWLEDGE_NAV: NavItem[] = [
  { path: "/memories", label: "记忆", icon: Brain, badgeKey: "memories" },
  { path: "/timeline", label: "时间线", icon: Clock },
];

const SYSTEM_NAV: NavItem[] = [{ path: "/settings", label: "设置", icon: Settings }];

const COLLAPSE_KEY = "sidebar_collapsed";

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
    <span className="ml-auto text-[10px] min-w-[1.25rem] h-5 px-1.5 rounded-full bg-warning/15 text-warning border border-warning/20 flex items-center justify-center font-medium">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavGroup({
  label,
  items,
  collapsed,
  badgeFor,
  proposedCount,
  pathname,
}: {
  label: string;
  items: NavItem[];
  collapsed: boolean;
  badgeFor: (key: BadgeKey) => number;
  proposedCount: number;
  pathname: string;
}) {
  return (
    <nav className="px-2 py-2">
      {!collapsed && <p className="section-label mb-1 px-2.5 py-1">{label}</p>}
      {items.map((item) => {
        const Icon = item.icon;
        const count = badgeFor(item.badgeKey ?? null);
        const to =
          item.badgeKey === "memories" && proposedCount > 0 ? "/memories?tab=review" : item.path;
        const chatActive = Boolean(item.chatActive && isChatRoute(pathname));
        return (
          <NavLink
            key={item.path}
            to={to}
            end={item.path === "/"}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => {
              const active = item.chatActive ? chatActive : isActive;
              return `nav-item relative mb-0.5 ${active ? "nav-item-active" : "nav-item-idle"} ${
                collapsed ? "justify-center px-0" : ""
              }`;
            }}
          >
            <Icon size={16} className="shrink-0" strokeWidth={1.75} />
            {!collapsed && (
              <>
                <span className="truncate">{item.label}</span>
                <NavBadge count={count} />
              </>
            )}
            {collapsed && count > 0 && (
              <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-warning" />
            )}
          </NavLink>
        );
      })}
    </nav>
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

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore quota / private mode
    }
  }, [collapsed]);

  const badgeFor = (key: BadgeKey) => {
    if (key === "approvals") return approvalCount;
    if (key === "inbox") return inboxCount;
    if (key === "memories") return proposedCount;
    return 0;
  };

  return (
    <aside
      className={`${
        collapsed ? "w-[4.25rem]" : "w-60"
      } bg-surface-sidebar border-r border-border-subtle flex flex-col shrink-0 transition-[width] duration-200 ease-out`}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div
        className={`border-b border-border-subtle flex items-center gap-2 ${
          collapsed ? "px-2 py-3 justify-center" : "px-3 py-3"
        }`}
      >
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold tracking-tight text-fg-primary leading-tight">
              Personal AI
            </h1>
            <p className="text-[11px] text-fg-tertiary mt-0.5 truncate">本地第二大脑</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="rounded-md p-1.5 text-fg-tertiary hover:bg-surface-hover hover:text-fg-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <NavGroup
          label="概览"
          items={OVERVIEW_NAV}
          collapsed={collapsed}
          badgeFor={badgeFor}
          proposedCount={proposedCount}
          pathname={location.pathname}
        />
        <div className="mx-3 border-t border-border-subtle/80" />
        <NavGroup
          label="任务"
          items={WORK_NAV}
          collapsed={collapsed}
          badgeFor={badgeFor}
          proposedCount={proposedCount}
          pathname={location.pathname}
        />
        <div className="mx-3 border-t border-border-subtle/80" />
        <NavGroup
          label="知识"
          items={KNOWLEDGE_NAV}
          collapsed={collapsed}
          badgeFor={badgeFor}
          proposedCount={proposedCount}
          pathname={location.pathname}
        />

        {onChatPage && !collapsed && (
          <>
            <div className="mx-3 border-t border-border-subtle/80" />
            <div className="px-2 pt-3 pb-1">
              <button type="button" onClick={onNewChat} className="nav-item nav-item-idle mb-1">
                <Plus size={16} className="shrink-0" strokeWidth={1.75} />
                <span>新对话</span>
              </button>
            </div>
            <div className="px-2 pb-2 space-y-0.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className={`group relative flex items-center justify-between rounded-md px-2.5 py-1.5 cursor-pointer transition-colors ${
                    activeConversationId === conv.id
                      ? "bg-surface-hover text-fg-primary"
                      : "text-fg-secondary hover:bg-surface-hover/70 hover:text-fg-primary"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm block">{conv.title || "未命名"}</span>
                    {conv.summary && (
                      <span className="truncate text-[11px] text-fg-disabled block">
                        {conv.summary}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-fg-tertiary hover:text-danger transition-all ml-1 shrink-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-md p-0.5"
                    title="删除对话"
                    aria-label="删除对话"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {conversations.length === 0 && (
                <p className="text-fg-disabled text-xs text-center py-6">暂无对话</p>
              )}
            </div>
          </>
        )}

        {onChatPage && collapsed && (
          <div className="px-2 py-2">
            <button
              type="button"
              onClick={onNewChat}
              className="nav-item nav-item-idle justify-center px-0"
              title="新对话"
              aria-label="新对话"
            >
              <Plus size={16} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle mt-auto">
        <NavGroup
          label="系统"
          items={SYSTEM_NAV}
          collapsed={collapsed}
          badgeFor={badgeFor}
          proposedCount={proposedCount}
          pathname={location.pathname}
        />
        {footer && isValidElement(footer)
          ? cloneElement(footer as React.ReactElement<{ compact?: boolean }>, {
              compact: collapsed,
            })
          : footer}
      </div>
    </aside>
  );
}
