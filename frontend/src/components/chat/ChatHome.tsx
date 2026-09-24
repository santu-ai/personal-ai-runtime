import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, Mail, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import {
  listMemoriesGrouped,
  listInboxEmails,
  type InboxEmail,
  type WorkItem,
} from "../../api/client";
import { listWorkItems } from "../../api/workItems";
import { useQuickChat } from "../../hooks/useQuickChat";
import { useApprovalsQuery } from "../../hooks/useApprovalsQuery";
import { useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";
import { useErrorStore } from "../../stores/errorStore";
import { timeAgo, isStagnant } from "../../utils/timeUtils";
import ProposedMemoryBanner from "./ProposedMemoryBanner";
import ChatComposer from "./ChatComposer";
import { COMPOSER_DRAFT_HOME, readComposerDraft, writeComposerDraft } from "./composerDraft";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";
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

type InsightMemory = { content: string; category?: string };

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

export default function ChatHome() {
  const conversations = useChatStore((s) => s.conversations);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const quickChat = useQuickChat();
  const addError = useErrorStore((s) => s.addError);
  const approvalsQuery = useApprovalsQuery();
  const pendingApprovals = approvalsQuery.data;
  const proposedQuery = useProposedMemoryCountQuery();
  const proposedCount = proposedQuery.data;

  const [memories, setMemories] = useState<InsightMemory[] | null>(null);
  const [goals, setGoals] = useState<WorkItem[] | null>(null);
  const [inbox, setInbox] = useState<InboxEmail[] | null>(null);
  const [fetching, setFetching] = useState(true);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [input, setInput] = useState(() => readComposerDraft(COMPOSER_DRAFT_HOME));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const sendingRef = useRef(false);
  const known = useRef<{
    memories: InsightMemory[] | null;
    goals: WorkItem[] | null;
    inbox: InboxEmail[] | null;
  }>({ memories: null, goals: null, inbox: null });
  const loadGen = useRef(0);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "早上好";
    if (h < 18) return "下午好";
    return "晚上好";
  })();

  const loadInsights = useCallback(async () => {
    const gen = ++loadGen.current;
    setFetching(true);
    const [memRes, goalRes, inboxRes] = await Promise.allSettled([
      listMemoriesGrouped({ claimStatus: "ratified" }),
      listWorkItems("goal"),
      listInboxEmails(),
    ]);
    if (gen !== loadGen.current) return;

    const failures: string[] = [];
    if (memRes.status === "fulfilled") {
      known.current.memories = memRes.value.memories ?? [];
    } else {
      failures.push(queryErrorMessage(memRes.reason, "加载记忆失败"));
    }
    if (goalRes.status === "fulfilled") {
      known.current.goals = goalRes.value;
    } else {
      failures.push(queryErrorMessage(goalRes.reason, "加载目标失败"));
    }
    if (inboxRes.status === "fulfilled") {
      known.current.inbox = inboxRes.value;
    } else {
      failures.push(queryErrorMessage(inboxRes.reason, "加载收件箱失败"));
    }

    setMemories(known.current.memories);
    setGoals(known.current.goals);
    setInbox(known.current.inbox);
    const incomplete =
      known.current.memories === null ||
      known.current.goals === null ||
      known.current.inbox === null;
    if (failures.length > 0) {
      addError(failures[0], "对话");
      setInsightError(incomplete ? failures[0] : null);
    } else {
      setInsightError(null);
    }
    setFetching(false);
  }, [addError]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (approvalsQuery.error && pendingApprovals === undefined) {
      addError(queryErrorMessage(approvalsQuery.error, "加载待审批失败"), "对话");
    }
  }, [approvalsQuery.error, pendingApprovals, addError]);

  useEffect(() => {
    if (proposedQuery.error && proposedCount === undefined) {
      addError(queryErrorMessage(proposedQuery.error, "加载待确认记忆失败"), "对话");
    }
  }, [proposedQuery.error, proposedCount, addError]);

  const memoryRows = memories ?? [];
  const goalRows = goals ?? [];
  const inboxRows = inbox ?? [];
  const stagnantGoals =
    goals === null
      ? []
      : goalRows.filter(
          (g) => g.status === "active" && isStagnant(g.last_activity_at, g.created_at),
        );
  const activeGoals = goals === null ? [] : goalRows.filter((g) => g.status === "active");
  const unreadInbox = inboxRows.length;
  const approvalsKnown = pendingApprovals !== undefined;
  const proposedKnown = proposedCount !== undefined;
  const approvalCount = pendingApprovals?.length ?? 0;
  const pictureComplete =
    memories !== null && goals !== null && inbox !== null && approvalsKnown && proposedKnown;
  const insightGap = memories === null || goals === null || inbox === null ? insightError : null;
  const approvalGap =
    !approvalsKnown && approvalsQuery.error
      ? queryErrorMessage(approvalsQuery.error, "加载待审批失败")
      : null;
  const proposedGap =
    !proposedKnown && proposedQuery.error
      ? queryErrorMessage(proposedQuery.error, "加载待确认记忆失败")
      : null;
  const rawGap = insightGap || approvalGap || proposedGap;
  // 查询错误对象要稳定，否则 useHeldQueryError 会在每次渲染时重跑并卡住页面。
  const gapError = useMemo(() => (rawGap ? new Error(rawGap) : null), [rawGap]);
  const insightBusy =
    fetching || Boolean(approvalsQuery.isFetching) || Boolean(proposedQuery.isFetching);
  const shownError = useHeldQueryError(
    pictureComplete,
    gapError,
    insightBusy,
    "加载近况失败",
    "home",
  );

  // 待决断优先：审批 > 停滞目标 > 邮件 > 引导。没读到的来源不当成零。
  const nudges: ProactiveNudge[] = [];

  if (approvalsKnown && approvalCount > 0) {
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

  if (goals !== null && stagnantGoals.length > 0) {
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

  if (inbox !== null && unreadInbox > 0) {
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
    pictureComplete &&
    approvalCount === 0 &&
    memoryRows.length === 0 &&
    activeGoals.length === 0 &&
    unreadInbox === 0 &&
    (proposedCount ?? 0) === 0
  ) {
    nudges.push({
      icon: Sparkles,
      message: "我还不太了解你。聊几句，让我记住对你重要的事",
      action: "开始对话",
      prompt: "我想让你记住一些关于我的事情：我的工作、兴趣和日常习惯",
      title: "建立记忆",
      tone: "success",
    });
  } else if (
    memories !== null &&
    goals !== null &&
    approvalsKnown &&
    memoryRows.length > 0 &&
    activeGoals.length === 0 &&
    approvalCount === 0
  ) {
    nudges.push({
      icon: Target,
      message: `我已经记住了 ${memoryRows.length} 件关于你的事。要不要设定一个目标？`,
      action: "规划目标",
      prompt: "根据你对我的了解，建议一个我这周可以完成的目标",
      title: "目标规划",
      tone: "insight",
    });
  }

  const handleNudge = (nudge: ProactiveNudge) => {
    if (!nudge.prompt) return;
    quickChat({ prompt: nudge.prompt, title: nudge.title });
  };

  const updateInput = (value: string) => {
    setInput(value);
    writeComposerDraft(COMPOSER_DRAFT_HOME, value);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    const title = text.length > 25 ? `讨论「${text.slice(0, 25)}…」` : `讨论「${text}」`;
    void (async () => {
      try {
        const ok = await quickChat({ prompt: text, title });
        if (!ok) return;
        writeComposerDraft(COMPOSER_DRAFT_HOME, "");
        if (mountedRef.current) setInput("");
      } finally {
        sendingRef.current = false;
      }
    })();
  };

  const retryInsights = () => {
    void loadInsights();
    if (approvalsQuery.isError) void approvalsQuery.refetch();
    if (proposedQuery.isError) void proposedQuery.refetch();
  };

  const lastConversation = conversations
    .filter((c) => c.updated_at)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

  const decisionCount =
    (approvalsKnown ? approvalCount : 0) +
    stagnantGoals.length +
    (inbox !== null && unreadInbox > 0 ? 1 : 0) +
    (proposedKnown && (proposedCount ?? 0) > 0 ? 1 : 0);
  const insightsSettled = !fetching && !approvalsQuery.isPending && !proposedQuery.isPending;
  const subtitle =
    !insightsSettled && !shownError
      ? "正在了解你的近况…"
      : decisionCount > 0
        ? "这些事需要你决断或推进"
        : pictureComplete
          ? "今天没有待决断事项，开始新对话吧"
          : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="space-y-5 pt-8 pb-2 text-center">
            <Brain size={32} strokeWidth={1.5} className="mx-auto mb-3 text-insight" />
            <h2 className="text-2xl font-semibold tracking-tight text-fg-primary">{greeting}</h2>
            {subtitle ? <p className="mt-2 text-sm text-fg-tertiary">{subtitle}</p> : null}
          </div>

          <ProposedMemoryBanner className="rounded-xl border border-insight/30" />

          {shownError || nudges.length > 0 ? (
            <div className="space-y-2">
              {shownError ? (
                <LoadErrorNotice
                  message={shownError}
                  busy={insightBusy}
                  onRetry={retryInsights}
                  testId="chat-home-load-error"
                  autoFocus={nudges.length === 0}
                />
              ) : null}
              {nudges.map((nudge, i) => {
                const tone = STATUS_TONE[nudge.tone];
                const actionTone =
                  nudge.tone === "warning"
                    ? "bg-warning/20 hover:bg-warning/30 text-warning"
                    : nudge.tone === "success"
                      ? "bg-success/20 hover:bg-success/30 text-success"
                      : "bg-insight/20 hover:bg-insight/30 text-insight";
                const actionClass = `shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${focusRing} ${actionTone}`;
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
                    {nudge.href ? (
                      <Link to={nudge.href} className={actionClass}>
                        {nudge.action}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleNudge(nudge)}
                        className={actionClass}
                      >
                        {nudge.action}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {lastConversation && (
            <Link
              to={`/chat/${lastConversation.id}`}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                ) {
                  return;
                }
                setActiveConversation(lastConversation.id);
              }}
              className={`block rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm transition-colors hover:border-border-strong hover:bg-surface-hover/30 ${focusRing}`}
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
            </Link>
          )}
        </div>
      </div>
      <div className="border-t border-border-subtle bg-surface-app/80 p-4 shrink-0 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl">
          <ChatComposer
            value={input}
            onChange={updateInput}
            onSend={handleSend}
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}
