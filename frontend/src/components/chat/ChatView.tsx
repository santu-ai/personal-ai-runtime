import { useState, useEffect, useLayoutEffect, useRef, useCallback, type FocusEvent } from "react";
import { Zap, MailSearch, Target as TargetIcon, BrainCircuit, Lightbulb } from "lucide-react";
import { type MemoryRow, type StreamEvent } from "../../api/client";
import { listWorkItems } from "../../api/workItems";
import { useErrorStore } from "../../stores/errorStore";
import { useChatStore } from "../../stores/chatStore";
import { useChatMessages } from "../../hooks/useChatMessages";
import { useApprovalFlow } from "../../hooks/useApprovalFlow";
import { matchPersistedConfirmation } from "../../hooks/matchPersistedConfirmation";
import { useApprovalsQuery } from "../../hooks/useApprovalsQuery";
import { useMemoriesGroupedQuery } from "../../hooks/useMemoriesQuery";
import MessageItem from "./MessageItem";
import ConfirmationDialog from "./ConfirmationDialog";
import ContextPanel from "./ContextPanel";
import ChatComposer from "./ChatComposer";
import WelcomeScreen from "./WelcomeScreen";
import ProposedMemoryBanner from "./ProposedMemoryBanner";
import LoadErrorNotice from "../ui/LoadErrorNotice";
import { readComposerDraft, writeComposerDraft } from "./composerDraft";
import { useConfirmFocusContainment } from "./confirmFocus";

interface Props {
  conversationId: string;
}

type SendOutcome = "blocked" | "finished" | "retry";

function focusIsBlank(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return true;
  return !(active instanceof HTMLElement) || !active.isConnected;
}

function focusInComposer(composer: HTMLTextAreaElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof Node)) return false;
  return composer.parentElement?.contains(active) ?? false;
}

/** 绘制前通知。测试在续写失败、卡片还在的同一轮读取焦点。 */
export const chatViewLayoutFocus = {
  notify: null as null | (() => void),
};

export default function ChatView({ conversationId }: Props) {
  const [input, setInput] = useState(() => readComposerDraft(conversationId));
  const [contextOpen, setContextOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const scrollSettleTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendLock = useRef(false);
  const generateFocusHeld = useRef(false);
  /** 焦点在「↓ 新消息 / ↓ 待确认」上。卸下后才交出去；移到别的控件就清掉。 */
  const jumpReturnRef = useRef(false);
  /** 点了「上下文」或「收起」。这一钮卸下后才交到对面；移到别的控件就清掉。 */
  const contextToggleFocus = useRef(false);
  const prevMemoryTotalRef = useRef<number | null>(null);
  const memoryNoticeRef = useRef<HTMLDivElement>(null);
  /** 关掉时焦点还在这条提示上。卸下后才交出去；已经在别的控件上就不记。 */
  const memoryNoticeReturnRef = useRef(false);

  const addError = useErrorStore((s) => s.addError);
  const pendingPrompt = useChatStore((s) => s.pendingPrompt);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);

  // Server state lives in TanStack Query; cache is invalidated by WS
  // `memory_changed` events so we never need setTimeout polling.
  const { data: memData } = useMemoriesGroupedQuery();
  const { data: convProposed } = useMemoriesGroupedQuery({
    claimStatus: "proposed",
    conversationId,
    order: "created_at_desc",
    limit: 3,
  });
  const recentMemories: MemoryRow[] = memData?.recent ?? [];
  const proposedTotal: number = convProposed?.total ?? convProposed?.memories.length ?? 0;
  const newestProposed = convProposed?.memories[0];
  // Track whether the user has sent at least one message in this session
  // — only then do we want "I just remembered" toasts. Initial cache load
  // must not fire a toast, and StrictMode double-invocation must not either.
  const hasSentRef = useRef(false);
  const pendingSentKeyRef = useRef<string | null>(null);

  const {
    messages,
    setMessages,
    isLoading,
    messagesHydrated,
    messagesLoadError,
    streamingContent,
    handleSend: sendMessageBase,
    loadMessages,
    cancelMessage,
    lastUserMessage,
    allToolResults,
  } = useChatMessages(conversationId, addError);

  const { pendingConfirmation, resolvingAction, setFromEvent, confirm, deny } =
    useApprovalFlow(conversationId);
  const confirmationRef = useRef<HTMLDivElement>(null);
  useConfirmFocusContainment(pendingConfirmation != null, confirmationRef);
  const focusedApprovalRef = useRef<string | null>(null);
  const focusAfterResolve = useRef<"confirm" | "deny" | null>(null);
  const [promptPick, setPromptPick] = useState(0);
  const promptPickSource = useRef<EventTarget | null>(null);
  const { data: pendingApprovals = [] } = useApprovalsQuery();

  useEffect(() => {
    if (!messagesHydrated || pendingConfirmation) return;
    const matched = matchPersistedConfirmation(messages, pendingApprovals, conversationId);
    if (!matched) return;
    setFromEvent(matched.assistantMsgId, matched.event);
  }, [
    messagesHydrated,
    messages,
    pendingApprovals,
    pendingConfirmation,
    conversationId,
    setFromEvent,
  ]);

  useEffect(() => {
    pendingSentKeyRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    setInput(readComposerDraft(conversationId));
  }, [conversationId]);

  const updateInput = useCallback(
    (value: string) => {
      setInput(value);
      writeComposerDraft(conversationId, value);
    },
    [conversationId],
  );

  const dispatchSend = useCallback(
    async (trimmed: string): Promise<SendOutcome> => {
      if (!trimmed || isLoading || pendingConfirmation) return "blocked";
      hasSentRef.current = true;
      isAtBottomRef.current = true;
      setShowJumpToLatest(false);
      isProgrammaticScrollRef.current = false;
      prevMemoryTotalRef.current = proposedTotal;
      const accepted =
        (await sendMessageBase(
          trimmed,
          (assistantMsgId, event: StreamEvent) => {
            setFromEvent(assistantMsgId, event, setMessages);
          },
          (error) => {
            addError(error, "对话");
          },
        )) === true;
      return accepted ? "finished" : "retry";
    },
    [
      isLoading,
      pendingConfirmation,
      sendMessageBase,
      setFromEvent,
      setMessages,
      addError,
      proposedTotal,
    ],
  );

  useEffect(() => {
    if (
      !pendingPrompt ||
      !messagesHydrated ||
      messagesLoadError ||
      isLoading ||
      pendingConfirmation
    )
      return;
    const key = `${conversationId}:${pendingPrompt}`;
    if (pendingSentKeyRef.current === key) return;
    pendingSentKeyRef.current = key;
    const prompt = pendingPrompt;
    void dispatchSend(prompt).then((outcome) => {
      if (outcome === "finished") setPendingPrompt(null);
      else pendingSentKeyRef.current = null;
    });
  }, [
    pendingPrompt,
    messagesHydrated,
    messagesLoadError,
    isLoading,
    pendingConfirmation,
    conversationId,
    setPendingPrompt,
    dispatchSend,
  ]);

  // Read memories via ref so WS `memory_changed` (which changes memData
  // identity every time) does NOT re-create this callback or re-fetch goals —
  // preventing request storms when the Pattern Aggregator emits many
  // MemoryDerived events in quick succession.
  const memDataRef = useRef(memData);
  memDataRef.current = memData;
  // One-shot: if the first suggestions load raced ahead of the memories
  // query, re-run once when memData first arrives (per conversation).
  const memHydratedRef = useRef(false);

  const loadSuggestions = useCallback(async () => {
    try {
      const goals = await listWorkItems("goal").catch(() => []);
      const allMems = memDataRef.current?.recent ?? [];
      const stale = goals.filter((g) => {
        if (g.status !== "active") return false;
        if (!g.last_activity_at) return true;
        return Date.now() - new Date(g.last_activity_at).getTime() > 3 * 86400000;
      });
      const chips: string[] = [];
      for (const g of stale.slice(0, 2)) {
        chips.push(`目标「${g.title}」已停滞，帮我分析下一步`);
      }
      if (allMems.length > 0) {
        const recent = allMems[0].content.slice(0, 40);
        chips.push(`你之前提到「${recent}${recent.length >= 40 ? "…" : ""}」，继续聊聊？`);
      }
      chips.push("查看今日收件箱摘要");
      chips.push("总结我们最近的对话进展");
      setSuggestions(chips.slice(0, 4));
    } catch {
      setSuggestions(["查看今日收件箱摘要", "帮我规划今天的工作", "总结最近的对话"]);
    }
  }, [conversationId]);

  useEffect(() => {
    // Conversation changed: reload chips. If memories are already cached,
    // mark hydrated so we don't immediately double-fetch.
    memHydratedRef.current = Boolean(memDataRef.current);
    void loadSuggestions();
  }, [loadSuggestions]);

  useEffect(() => {
    if (!memData || memHydratedRef.current) return;
    memHydratedRef.current = true;
    void loadSuggestions();
  }, [memData, loadSuggestions]);

  const dismissMemoryNotice = useCallback(() => {
    const root = memoryNoticeRef.current;
    const active = document.activeElement;
    if (root && active instanceof Node && root.contains(active)) {
      memoryNoticeReturnRef.current = true;
    }
    setMemoryNotice(null);
  }, []);

  useEffect(() => {
    prevMemoryTotalRef.current = null;
    dismissMemoryNotice();
  }, [conversationId, dismissMemoryNotice]);

  // Surface a "待确认" toast when this conversation yields a new proposed memory.
  // Uses the conversation-scoped proposed count (not the global memory total).
  // Suppressed until the user has actually sent a message, so initial mount /
  // route changes / StrictMode double-invoke never fire a spurious toast.
  useEffect(() => {
    if (prevMemoryTotalRef.current === null) {
      prevMemoryTotalRef.current = proposedTotal;
      return;
    }
    if (proposedTotal > prevMemoryTotalRef.current && hasSentRef.current) {
      if (newestProposed) {
        setMemoryNotice(
          `待确认：${newestProposed.content.slice(0, 40)}${newestProposed.content.length > 40 ? "…" : ""}`,
        );
        const t = setTimeout(() => dismissMemoryNotice(), 6000);
        prevMemoryTotalRef.current = proposedTotal;
        return () => clearTimeout(t);
      }
    }
    prevMemoryTotalRef.current = proposedTotal;
  }, [proposedTotal, newestProposed, dismissMemoryNotice, conversationId]);

  const BOTTOM_THRESHOLD_PX = 80;

  const updateIsAtBottom = useCallback(() => {
    // Ignore scroll events caused by our own stick-to-bottom / jump scrolls,
    // otherwise smooth/layout adjustments briefly look "not at bottom" and
    // permanently disable auto-follow for the rest of the stream.
    if (isProgrammaticScrollRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < BOTTOM_THRESHOLD_PX;
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setShowJumpToLatest(false);
    }
  }, []);

  const handleScroll = useCallback(() => {
    updateIsAtBottom();
  }, [updateIsAtBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior });
    if (scrollSettleTimerRef.current !== null) {
      window.clearTimeout(scrollSettleTimerRef.current);
    }
    // Instant scrolls settle within a frame; smooth jump needs a short grace.
    const settleMs = behavior === "smooth" ? 320 : 0;
    scrollSettleTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      isAtBottomRef.current = true;
      setShowJumpToLatest(false);
      scrollSettleTimerRef.current = null;
    }, settleMs);
  }, []);

  const jumpToLatest = useCallback(() => {
    jumpReturnRef.current = true;
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

  const releaseJumpReturn = (event: FocusEvent<HTMLButtonElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof HTMLElement) || !next.isConnected) return;
    if (next === document.body || next === document.documentElement) return;
    jumpReturnRef.current = false;
  };

  useEffect(() => {
    // 确认卡片长在记录下面，会把记录区挤矮。正跟在底部时再滚一次，刚才那一轮才不会被裁掉。
    // 已经往上翻了就不硬拉，只留下「↓ 待确认」。
    if (!pendingConfirmation) return;
    if (!isAtBottomRef.current) {
      setShowJumpToLatest(true);
      return;
    }
    scrollToBottom("auto");
  }, [pendingConfirmation, scrollToBottom]);

  useEffect(() => {
    if (!isAtBottomRef.current) {
      // Only surface the jump chip while new content is actually arriving.
      if (isLoading || streamingContent) {
        setShowJumpToLatest(true);
      }
      return;
    }
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      // Use instant scroll while streaming so onScroll never sees a mid-animation
      // "away from bottom" gap that would poison isAtBottomRef.
      scrollToBottom("auto");
      scrollRafRef.current = null;
    });
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [messages, streamingContent, isLoading, scrollToBottom]);

  useLayoutEffect(() => {
    // 待确认时焦点留给确认或回答，不要落回已经禁用的输入框。
    if (pendingConfirmation) return;
    const composer = inputRef.current;
    if (!composer || composer.disabled) return;
    if (isLoading) {
      // 同一轮生成只补一次。欢迎屏换成会话时，输入框卸掉，焦点会先掉到空白处。
      if (generateFocusHeld.current) return;
      generateFocusHeld.current = true;
      if (!focusIsBlank()) return;
      composer.focus();
      return;
    }
    generateFocusHeld.current = false;
    // 结束或失败后，焦点还在输入栏，或掉到空白处，才留在输入框。已经移走不再抢。
    if (!focusIsBlank() && !focusInComposer(composer)) return;
    composer.focus();
  }, [isLoading, pendingConfirmation, initialLoad]);

  useLayoutEffect(() => {
    const approvalId = pendingConfirmation
      ? pendingConfirmation.approvalId || pendingConfirmation.toolCall.id
      : null;
    if (!approvalId) {
      focusedApprovalRef.current = null;
      return;
    }
    if (focusedApprovalRef.current === approvalId) return;
    const root = confirmationRef.current;
    const answer = root?.querySelector<HTMLElement>("textarea");
    const confirmButton = root?.querySelector<HTMLElement>("button:not([disabled])");
    const target = answer ?? confirmButton;
    // 欢迎屏那一帧还没有卡片。等卡片挂上再移焦点，避免记成已经移过。
    // 卡片挂上的同一帧里输入框会被禁用，浏览器会把焦点卸到页面空白处。
    // 绘制前落到确认或回答，读历史恢复出来的确认才不会停在 body。
    if (!target) return;
    focusedApprovalRef.current = approvalId;
    target.focus();
  }, [pendingConfirmation, initialLoad]);

  // 续写失败且这张卡片还在时，焦点已经掉到页面空白，或还停在已经禁用的按钮上，才补回去。
  // 发送回答变成不可用时，浏览器会先把焦点卸到空白。放到绘制前，不先停在页面空白，也不停在已经禁用的按钮上。
  // 放在下一张确认的交接之后：新卡片先拿到焦点，这里不再抢。已经移到别的控件上也不再抢。
  useLayoutEffect(() => {
    if (resolvingAction) return;
    const action = focusAfterResolve.current;
    if (!action) return;
    focusAfterResolve.current = null;
    if (!pendingConfirmation) return;
    const active = document.activeElement;
    const idle =
      !active ||
      active === document.body ||
      active === document.documentElement ||
      !(active instanceof HTMLElement) ||
      !active.isConnected ||
      (active instanceof HTMLButtonElement && active.disabled);
    if (!idle) return;
    const root = confirmationRef.current;
    const button = root?.querySelector<HTMLButtonElement>(
      `button[data-confirm-action="${action}"]`,
    );
    if (button && !button.disabled) {
      button.focus();
      return;
    }
    root?.querySelector<HTMLElement>("textarea")?.focus();
  }, [resolvingAction, pendingConfirmation]);

  // 点胶囊的这一轮，绘制前把焦点放进输入框。已经移到别的控件上就不再抢。
  // 只认刚点的那一颗：焦点停在另一颗胶囊上时，不能当成还在这一颗上。
  // 不放到定时器里：晚一拍会先停在胶囊上，也会把已经点开的控件抢回去。
  useLayoutEffect(() => {
    if (promptPick === 0) return;
    const field = inputRef.current;
    if (!field || field.disabled) return;
    const active = document.activeElement;
    const source = promptPickSource.current;
    const onPicked =
      source instanceof HTMLElement &&
      active instanceof HTMLElement &&
      (active === source || source.contains(active));
    if (!focusIsBlank() && !onPicked) return;
    field.focus();
    const end = field.value.length;
    if (typeof field.setSelectionRange === "function") {
      field.setSelectionRange(end, end);
    }
  }, [promptPick]);

  // 「↓ 新消息」或「↓ 待确认」卸下的同一轮交焦点。放到绘制前，不先停在页面空白。
  // 已经移到别的控件上就不再抢。滚回底部但焦点不在这一钮上时也不抢。
  useLayoutEffect(() => {
    if (showJumpToLatest || !jumpReturnRef.current) return;
    jumpReturnRef.current = false;
    if (!focusIsBlank()) return;
    if (pendingConfirmation) {
      const root = confirmationRef.current;
      const answer = root?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
      const button = root?.querySelector<HTMLButtonElement>("button:not([disabled])");
      const target = answer ?? button;
      if (target && document.activeElement !== target) target.focus();
      return;
    }
    const composer = inputRef.current;
    if (!composer || composer.disabled || document.activeElement === composer) return;
    composer.focus();
  }, [showJumpToLatest, pendingConfirmation]);

  // 「上下文」和「收起」互相卸下。放到绘制前，不先停在页面空白。
  // 已经移到别的控件上就不再抢。
  useLayoutEffect(() => {
    if (!contextToggleFocus.current) return;
    contextToggleFocus.current = false;
    if (!focusIsBlank()) return;
    const next = document.querySelector<HTMLButtonElement>("[data-confirm-exit]");
    if (next && document.activeElement !== next) next.focus();
  }, [contextOpen]);

  // 「待确认：…」卸下的同一轮交焦点。放到绘制前，不先停在页面空白。
  // 已经移到别的控件上就不再抢。输入框还能输入就落到输入框；待确认时落到回答框或确认按钮；
  // 再没有就落到「上下文」，已经展开时落到「收起」。
  useLayoutEffect(() => {
    if (memoryNotice || !memoryNoticeReturnRef.current) return;
    memoryNoticeReturnRef.current = false;
    if (!focusIsBlank()) return;
    const composer = inputRef.current;
    if (composer && !composer.disabled) {
      composer.focus();
      return;
    }
    const root = confirmationRef.current;
    const answer = root?.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
    const button = root?.querySelector<HTMLButtonElement>("button:not([disabled])");
    const target = answer ?? button;
    if (target && document.activeElement !== target) {
      target.focus();
      return;
    }
    const exit = document.querySelector<HTMLButtonElement>("[data-confirm-exit]");
    if (exit && document.activeElement !== exit) exit.focus();
  }, [memoryNotice]);

  useLayoutEffect(() => {
    chatViewLayoutFocus.notify?.();
  });

  const handleSend = useCallback(async () => {
    const raw = input;
    const trimmed = raw.trim();
    if (!trimmed || isLoading || pendingConfirmation || sendLock.current) return;
    sendLock.current = true;
    setInput("");
    writeComposerDraft(conversationId, "");
    try {
      const outcome = await dispatchSend(trimmed);
      if (outcome === "blocked") {
        setInput(raw);
        writeComposerDraft(conversationId, raw);
      }
    } finally {
      sendLock.current = false;
    }
  }, [input, isLoading, pendingConfirmation, conversationId, dispatchSend]);

  const handleConfirm = useCallback(
    async (answer?: string) => {
      focusAfterResolve.current = "confirm";
      await confirm(setMessages, addError, answer);
    },
    [confirm, setMessages, addError],
  );

  const handleDeny = useCallback(async () => {
    focusAfterResolve.current = "deny";
    await deny(setMessages, addError);
  }, [deny, setMessages, addError]);

  const handlePickPrompt = useCallback(
    (prompt: string, source?: EventTarget | null) => {
      const current = inputRef.current?.value ?? input;
      // 已经写的字留下。还是空的，才放进这句。
      if (!current.trim()) updateInput(prompt);
      promptPickSource.current = source ?? null;
      setPromptPick((tick) => tick + 1);
    },
    [input, updateInput],
  );

  // Mark initial load complete once messages are loaded or user sends a message
  useEffect(() => {
    if (messages.length > 0 || pendingConfirmation) {
      setInitialLoad(false);
    }
  }, [messages.length, pendingConfirmation]);

  // 读失败且还没有消息时，不把这段对话写成新的空会话。
  if (messagesLoadError && messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ProposedMemoryBanner conversationId={conversationId} />
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-lg">
            <LoadErrorNotice
              message={messagesLoadError}
              busy={!messagesHydrated}
              onRetry={() => void loadMessages()}
              testId="chat-messages-load-error"
            />
          </div>
        </div>
      </div>
    );
  }

  // Welcome screen when no messages and still in initial load
  if (initialLoad && messages.length === 0 && !isLoading && !pendingPrompt) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ProposedMemoryBanner conversationId={conversationId} />
        <WelcomeScreen
          recentMemories={recentMemories}
          suggestions={suggestions}
          onPickPrompt={handlePickPrompt}
        />
        <div className="border-t border-border-subtle p-4">
          <div className="max-w-3xl mx-auto">
            <ChatComposer
              value={input}
              onChange={updateInput}
              onSend={handleSend}
              onCancel={isLoading ? cancelMessage : undefined}
              disabled={isLoading || !!pendingConfirmation}
              inputRef={inputRef}
            />
            <p className="text-xs text-fg-disabled mt-2 text-center">
              Personal AI Runtime 可能会犯错，请验证重要信息。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ProposedMemoryBanner conversationId={conversationId} />
      {memoryNotice && (
        <div
          ref={memoryNoticeRef}
          data-memory-notice=""
          className="px-4 py-2 bg-insight/10 border-b border-insight/30 flex items-center gap-2 text-xs text-insight animate-pulse"
        >
          <BrainCircuit size={14} className="shrink-0" />
          <span className="flex-1 truncate">{memoryNotice}</span>
          <button
            type="button"
            onClick={() => dismissMemoryNotice()}
            className="group inline-flex max-w-full shrink-0 items-center justify-center rounded text-insight/70 hover:text-insight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label="关闭"
          >
            <span aria-hidden className="text-xl leading-none group-focus-visible:hidden">
              ×
            </span>
            <span
              data-icon-name=""
              className="hidden whitespace-nowrap text-center text-[10px] leading-tight group-focus-visible:block"
            >
              关闭
            </span>
          </button>
        </div>
      )}
      {!contextOpen && (
        <div className="flex shrink-0 items-center justify-end border-b border-border-subtle px-3 py-1.5">
          <button
            type="button"
            data-confirm-exit=""
            onClick={() => {
              contextToggleFocus.current = true;
              setContextOpen(true);
            }}
            className="rounded-md border border-border-subtle bg-surface-overlay px-2.5 py-1 text-xs text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            title="展开上下文面板"
          >
            上下文
          </button>
        </div>
      )}
      <div className="flex-1 flex flex-row min-h-0 relative">
        <div className="flex-1 relative min-h-0 min-w-0">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            data-testid="chat-transcript"
            className="h-full overflow-y-auto px-4 py-4"
          >
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg) => (
                <MessageItem key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
          {showJumpToLatest && (
            <button
              type="button"
              data-chat-jump=""
              onClick={jumpToLatest}
              onFocus={() => {
                jumpReturnRef.current = true;
              }}
              onBlur={releaseJumpReturn}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 text-xs rounded-full bg-surface-raised border border-border-strong text-fg-secondary shadow-md hover:text-fg-primary hover:border-focus-ring transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {pendingConfirmation ? "↓ 待确认" : "↓ 新消息"}
            </button>
          )}
        </div>
        <ContextPanel
          lastUserMessage={lastUserMessage}
          toolResults={allToolResults}
          open={contextOpen}
          onToggle={() => {
            contextToggleFocus.current = true;
            setContextOpen((open) => !open);
          }}
        />
      </div>

      {pendingConfirmation && (
        <div className="px-4 py-2 shrink-0">
          <div
            ref={confirmationRef}
            role="group"
            aria-label="待确认"
            tabIndex={-1}
            className="max-w-3xl mx-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            key={pendingConfirmation.approvalId || pendingConfirmation.toolCall.id}
          >
            <ConfirmationDialog
              toolCall={pendingConfirmation.toolCall}
              busyAction={resolvingAction}
              onConfirm={handleConfirm}
              onDeny={handleDeny}
            />
          </div>
        </div>
      )}

      <div className="border-t border-border-subtle bg-surface-app/80 p-4 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl">
          {suggestions.length > 0 && !isLoading && !pendingConfirmation && (
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map((s) => {
                const SIcon = getSuggestionIcon(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={(e) => handlePickPrompt(s, e.currentTarget)}
                    className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface-raised px-3 py-1.5 text-xs text-fg-secondary shadow-sm transition-all hover:border-border-strong hover:bg-surface-hover hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <SIcon size={12} className="text-fg-secondary" />
                    <span>{s.length > 50 ? s.slice(0, 50) + "…" : s}</span>
                  </button>
                );
              })}
            </div>
          )}
          <ChatComposer
            value={input}
            onChange={updateInput}
            onSend={handleSend}
            onCancel={isLoading ? cancelMessage : undefined}
            disabled={isLoading || !!pendingConfirmation}
            inputRef={inputRef}
          />
          <p className="mt-2 text-center text-xs text-fg-disabled">
            Personal AI Runtime 可能会犯错，请验证重要信息。
          </p>
        </div>
      </div>
    </div>
  );
}

function getSuggestionIcon(label: string) {
  // Kept local to ChatView for the inline suggestion chips; the welcome
  // screen has its own copy inside WelcomeScreen.
  const meta: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }> }> =
    {
      目标: { icon: TargetIcon },
      收件箱: { icon: MailSearch },
      对话: { icon: BrainCircuit },
      规划: { icon: Lightbulb },
    };
  for (const [key, m] of Object.entries(meta)) {
    if (label.includes(key)) return m.icon;
  }
  return Zap;
}
