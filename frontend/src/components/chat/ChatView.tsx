import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Zap, MailSearch, Target as TargetIcon, BrainCircuit, Lightbulb } from "lucide-react";
import { type MemoryRow, type StreamEvent } from "../../api/client";
import { listWorkItems } from "../../api/workItems";
import { useErrorStore } from "../../stores/errorStore";
import { useChatStore } from "../../stores/chatStore";
import { useChatMessages } from "../../hooks/useChatMessages";
import { useApprovalFlow } from "../../hooks/useApprovalFlow";
import { useMemoriesGroupedQuery, useProposedMemoryCountQuery } from "../../hooks/useMemoriesQuery";
import MessageItem from "./MessageItem";
import ConfirmationDialog from "./ConfirmationDialog";
import ContextPanel from "./ContextPanel";
import ChatComposer from "./ChatComposer";
import WelcomeScreen from "./WelcomeScreen";

interface Props {
  conversationId: string;
}

export default function ChatView({ conversationId }: Props) {
  const [input, setInput] = useState("");
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
  const prevMemoryTotalRef = useRef<number | null>(null);

  const addError = useErrorStore((s) => s.addError);
  const pendingPrompt = useChatStore((s) => s.pendingPrompt);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);

  // Server state lives in TanStack Query; cache is invalidated by WS
  // `memory_changed` events so we never need setTimeout polling.
  const { data: memData } = useMemoriesGroupedQuery();
  const { data: proposedCount = 0 } = useProposedMemoryCountQuery();
  const recentMemories: MemoryRow[] = memData?.recent ?? [];
  const memoryTotal: number = memData?.memories.length ?? 0;
  // Track whether the user has sent at least one message in this session
  // — only then do we want "I just remembered" toasts. Initial cache load
  // must not fire a toast, and StrictMode double-invocation must not either.
  const hasSentRef = useRef(false);

  const {
    messages,
    setMessages,
    isLoading,
    streamingContent,
    handleSend: sendMessageBase,
    lastUserMessage,
    allToolResults,
  } = useChatMessages(conversationId, addError);

  const { pendingConfirmation, setFromEvent, confirm, deny } = useApprovalFlow(conversationId);

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      setPendingPrompt(null);
    }
  }, [pendingPrompt, setPendingPrompt]);

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

  // Surface a "I just remembered …" toast when the memory cache grows.
  // Uses the TOTAL memory count (not the recent slice length, which is
  // capped at 3 and would silently miss growth from 5 → 6). Suppressed
  // until the user has actually sent a message, so initial mount / route
  // changes / StrictMode double-invoke never fire a spurious toast.
  useEffect(() => {
    if (prevMemoryTotalRef.current === null) {
      prevMemoryTotalRef.current = memoryTotal;
      return;
    }
    if (memoryTotal > prevMemoryTotalRef.current && hasSentRef.current) {
      const newest = recentMemories[0];
      if (newest) {
        setMemoryNotice(
          `我刚记住了：${newest.content.slice(0, 40)}${newest.content.length > 40 ? "…" : ""}`,
        );
        const t = setTimeout(() => setMemoryNotice(null), 6000);
        prevMemoryTotalRef.current = memoryTotal;
        return () => clearTimeout(t);
      }
    }
    prevMemoryTotalRef.current = memoryTotal;
  }, [memoryTotal, recentMemories]);

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
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    scrollToBottom("smooth");
  }, [scrollToBottom]);

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

  useEffect(() => {
    if (!isLoading && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLoading]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || pendingConfirmation) return;
    setInput("");
    hasSentRef.current = true;
    // Sending a new message re-engages stick-to-bottom.
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    isProgrammaticScrollRef.current = false;
    // Reset the memory baseline so a memory derived from THIS exchange can
    // still trigger the "I just remembered" toast once.
    prevMemoryTotalRef.current = memData?.memories.length ?? 0;
    await sendMessageBase(
      trimmed,
      (assistantMsgId, event: StreamEvent) => {
        setFromEvent(assistantMsgId, event, setMessages);
      },
      (error) => {
        addError(error, "对话");
      },
    );
    // No setTimeout here — memory refresh arrives via WS `memory_changed`,
    // which invalidates the TanStack Query cache automatically.
  }, [
    input,
    isLoading,
    pendingConfirmation,
    sendMessageBase,
    setFromEvent,
    setMessages,
    addError,
    memData,
  ]);

  const handleConfirm = useCallback(async () => {
    await confirm(setMessages, addError);
  }, [confirm, setMessages, addError]);

  const handleDeny = useCallback(async () => {
    await deny(setMessages, addError);
  }, [deny, setMessages, addError]);

  const handlePickPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Mark initial load complete once messages are loaded or user sends a message
  useEffect(() => {
    if (messages.length > 0 || pendingConfirmation) {
      setInitialLoad(false);
    }
  }, [messages.length, pendingConfirmation]);

  // Welcome screen when no messages and still in initial load
  if (initialLoad && messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {proposedCount > 0 && (
          <Link
            to="/memories?tab=review"
            className="px-4 py-2 bg-insight/10 border-b border-insight/30 text-xs text-insight hover:bg-insight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {proposedCount} 条记忆待确认后才会进入对话 →
          </Link>
        )}
        <WelcomeScreen
          recentMemories={recentMemories}
          suggestions={suggestions}
          onPickPrompt={handlePickPrompt}
        />
        <div className="border-t border-border-subtle p-4">
          <div className="max-w-3xl mx-auto">
            <ChatComposer
              value={input}
              onChange={setInput}
              onSend={handleSend}
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
    <div className="flex-1 flex flex-row min-h-0 relative">
      <div className="flex-1 flex flex-col min-h-0">
        {proposedCount > 0 && (
          <Link
            to="/memories?tab=review"
            className="px-4 py-2 bg-insight/10 border-b border-insight/30 text-xs text-insight hover:bg-insight/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {proposedCount} 条记忆待确认后才会进入对话 →
          </Link>
        )}
        {memoryNotice && (
          <div className="px-4 py-2 bg-insight/10 border-b border-insight/30 flex items-center gap-2 text-xs text-insight animate-pulse">
            <span>🧠</span>
            <span className="flex-1 truncate">{memoryNotice}</span>
            <button
              type="button"
              onClick={() => setMemoryNotice(null)}
              className="text-insight/70 hover:text-insight shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex-1 relative min-h-0">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
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
              onClick={jumpToLatest}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 text-xs rounded-full bg-surface-raised border border-border-strong text-fg-secondary shadow-md hover:text-fg-primary hover:border-focus-ring transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              ↓ 新消息
            </button>
          )}
        </div>

        {pendingConfirmation && (
          <div className="border-t border-warning/40 px-4 py-3 bg-surface-raised/95 backdrop-blur-sm shrink-0">
            <ConfirmationDialog
              toolCall={pendingConfirmation.toolCall}
              onConfirm={handleConfirm}
              onDeny={handleDeny}
            />
          </div>
        )}

        <div className="border-t border-border-subtle p-4">
          <div className="max-w-3xl mx-auto">
            {suggestions.length > 0 && !isLoading && !pendingConfirmation && (
              <div className="flex flex-wrap gap-2 mb-3">
                {suggestions.map((s) => {
                  const SIcon = getSuggestionIcon(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handlePickPrompt(s)}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-surface-overlay hover:bg-border-strong text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
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
              onChange={setInput}
              onSend={handleSend}
              disabled={isLoading || !!pendingConfirmation}
              inputRef={inputRef}
            />
            <p className="text-xs text-fg-disabled mt-2 text-center">
              Personal AI Runtime 可能会犯错，请验证重要信息。
            </p>
          </div>
        </div>
      </div>

      <ContextPanel
        lastUserMessage={lastUserMessage}
        toolResults={allToolResults}
        open={contextOpen}
        onToggle={() => setContextOpen(!contextOpen)}
      />
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
