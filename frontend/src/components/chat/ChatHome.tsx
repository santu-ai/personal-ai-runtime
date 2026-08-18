import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, Mail, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import {
  listMemoriesGrouped,
  listInboxEmails,
  type Conversation,
  type WorkItem,
} from "../../api/client";
import { listWorkItems } from "../../api/workItems";
import { useQuickChat } from "../../hooks/useQuickChat";
import { useApprovalsQuery } from "../../hooks/useApprovalsQuery";
import { useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";
import { timeAgo, isStagnant } from "../../utils/timeUtils";
import ProposedMemoryBanner from "./ProposedMemoryBanner";
import ChatComposer from "./ChatComposer";
import { STATUS_TONE } from "../ui/statusTone";

interface ProactiveNudge {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  message: string;
  action: string;
  prompt?: string;
  title: string;
  tone: "warning" | "insight" | "success";
  /** If set, navigate here instead of starting a chat. */
  href?: string;
}

export default function ChatHome() {
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const quickChat = useQuickChat();
  const { data: pendingApprovals = [] } = useApprovalsQuery();
  const { data: proposedCount = 0, isPending: proposedPending } = useProposedMemoryCountQuery();

  const [memories, setMemories] = useState<{ content: string; category?: string }[]>([]);
  const [goals, setGoals] = useState<WorkItem[]>([]);
  const [inbox, setInbox] = useState<{ id: string; subject?: string; sender?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "早上好";
    if (h < 18) return "下午好";
    return "晚上好";
  })();

  useEffect(() => {
    loadInsights();
  }, []);

  const loadInsights = async () => {
    try {
      const [memData, goalData, inboxData] = await Promise.all([
        listMemoriesGrouped({ claimStatus: "ratified" }).catch(() => ({ memories: [] })),
        listWorkItems("goal").catch(() => []),
        listInboxEmails().catch(() => []),
      ]);
      setMemories(memData.memories ?? []);
      setGoals(goalData);
      setInbox(inboxData);
    } catch {
      // optional
    } finally {
      setLoading(false);
    }
  };

  const stagnantGoals = goals.filter(
    (g) => g.status === "active" && isStagnant(g.last_activity_at, g.created_at),
  );
  const activeGoals = goals.filter((g) => g.status === "active");
  const unreadInbox = inbox.length;
  const approvalCount = pendingApprovals.length;

  // 待决断优先：审批 > 停滞目标 > 邮件 > 引导
  const nudges: ProactiveNudge[] = [];

  if (approvalCount > 0) {
    nudges.push({
      icon: ShieldCheck,
      message:
        approvalCount === 1
          ? "有 1 项工具调用等待你批准"
          : `有 ${approvalCount} 项工具调用等待你批准`,
      action: "去审批",
      title: "待审批",
      tone: "warning",
      href: "/approvals",
    });
  }

  if (stagnantGoals.length > 0) {
    const names = stagnantGoals
      .slice(0, 2)
      .map((g) => g.title)
      .join("、");
    nudges.push({
      icon: Target,
      message:
        stagnantGoals.length === 1
          ? `「${names}」已经 ${Math.round((Date.now() - new Date(stagnantGoals[0].last_activity_at || stagnantGoals[0].created_at).getTime()) / 86400000)} 天没有进展了`
          : `你有 ${stagnantGoals.length} 个目标停滞了，包括：${names}`,
      action: "聊聊怎么推进",
      prompt: `我的目标「${names}」停滞了一段时间，帮我分析原因并建议下一步行动`,
      title: "推进停滞目标",
      tone: "warning",
    });
  }

  if (unreadInbox > 0) {
    nudges.push({
      icon: Mail,
      message: `收件箱有 ${unreadInbox} 封邮件，可能有需要你处理的`,
      action: "帮我看看",
      prompt: "帮我看看收件箱里有什么重要的邮件，总结一下需要我处理的",
      title: "收件箱摘要",
      tone: "insight",
    });
  }

  if (
    approvalCount === 0 &&
    memories.length === 0 &&
    activeGoals.length === 0 &&
    unreadInbox === 0 &&
    proposedCount === 0
  ) {
    nudges.push({
      icon: Sparkles,
      message: "我还不太了解你。聊几句，让我记住对你重要的事",
      action: "开始对话",
      prompt: "我想让你记住一些关于我的事情：我的工作、兴趣和日常习惯",
      title: "建立记忆",
      tone: "success",
    });
  } else if (memories.length > 0 && activeGoals.length === 0 && approvalCount === 0) {
    nudges.push({
      icon: Target,
      message: `我已经记住了 ${memories.length} 件关于你的事。要不要设定一个目标？`,
      action: "规划目标",
      prompt: "根据你对我的了解，建议一个我这周可以完成的目标",
      title: "目标规划",
      tone: "insight",
    });
  }

  const handleNudge = (nudge: ProactiveNudge) => {
    if (nudge.href) {
      navigate(nudge.href);
      return;
    }
    if (nudge.prompt) {
      quickChat({ prompt: nudge.prompt, title: nudge.title });
    }
  };

  const handleContinueConversation = (conv: Conversation) => {
    setActiveConversation(conv.id);
    navigate(`/chat/${conv.id}`);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    const title = text.length > 25 ? `讨论「${text.slice(0, 25)}…」` : `讨论「${text}」`;
    void quickChat({ prompt: text, title });
  };

  const lastConversation = conversations
    .filter((c) => c.updated_at)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

  const decisionCount =
    approvalCount + stagnantGoals.length + (unreadInbox > 0 ? 1 : 0) + (proposedCount > 0 ? 1 : 0);
  const insightsReady = !loading && !proposedPending;
  const subtitle = !insightsReady
    ? "正在了解你的近况…"
    : decisionCount > 0
      ? "这些事需要你决断或推进"
      : "今天没有待决断事项，开始新对话吧";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="text-center pt-6 pb-2">
            <Brain size={36} strokeWidth={1.5} className="mx-auto mb-3 text-insight" />
            <h2 className="text-2xl font-semibold text-fg-primary">{greeting}</h2>
            <p className="text-fg-tertiary mt-2 text-sm">{subtitle}</p>
          </div>

          <ProposedMemoryBanner className="rounded-xl border border-insight/30" />

          {insightsReady && (
            <div className="space-y-2">
              {nudges.map((nudge, i) => {
                const tone = STATUS_TONE[nudge.tone];
                const actionClass =
                  nudge.tone === "warning"
                    ? "bg-warning/20 hover:bg-warning/30 text-warning"
                    : nudge.tone === "success"
                      ? "bg-success/20 hover:bg-success/30 text-success"
                      : "bg-insight/20 hover:bg-insight/30 text-insight";
                const Icon = nudge.icon;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-4 rounded-xl border ${tone.surface} transition-colors`}
                  >
                    <Icon size={18} className={`shrink-0 ${tone.icon}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-fg-primary">{nudge.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleNudge(nudge)}
                      className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${actionClass}`}
                    >
                      {nudge.action}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {lastConversation && (
            <div
              className="bg-surface-raised border border-border-subtle rounded-xl p-4 hover:border-border-strong transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              onClick={() => handleContinueConversation(lastConversation)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm text-fg-tertiary">继续上次</span>
              </div>
              <p className="text-sm text-fg-primary">{lastConversation.title || "新对话"}</p>
              {lastConversation.summary && (
                <p className="text-xs text-fg-tertiary mt-1 line-clamp-1">
                  {lastConversation.summary}
                </p>
              )}
              <p className="text-xs text-fg-disabled mt-2">
                {timeAgo(lastConversation.updated_at)}
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-border-subtle p-4 shrink-0">
        <div className="max-w-2xl mx-auto">
          <ChatComposer value={input} onChange={setInput} onSend={handleSend} inputRef={inputRef} />
        </div>
      </div>
    </div>
  );
}
