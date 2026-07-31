import { useState, useEffect, useRef, useCallback } from "react";
import { Zap, MailSearch, Target as TargetIcon, BrainCircuit, Lightbulb } from "lucide-react";
import { type MemoryRow } from "../../api/client";
import { type StreamEvent } from "../../api/client";
import { listWorkItems } from "../../api/workItems";
import { useErrorStore } from "../../stores/errorStore";
import { useChatStore } from "../../stores/chatStore";
import { useChatMessages } from "../../hooks/useChatMessages";
import { useApprovalFlow } from "../../hooks/useApprovalFlow";
import { useMemoriesGroupedQuery } from "../../hooks/useMemoriesQuery";
import MessageItem from "./MessageItem";
import ConfirmationDialog from "./ConfirmationDialog";
import ContextPanel from "./ContextPanel";
import VoiceInput from "./VoiceInput";

interface Props {
  conversationId: string;
}

const SUGGESTION_META: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  目标: { icon: TargetIcon },
  收件箱: { icon: MailSearch },
  对话: { icon: BrainCircuit },
  规划: { icon: Lightbulb },
};

const CAPABILITY_CHIPS: Array<{ icon: string; label: string; prompt: string }> = [
  { icon: "📄", label: "读写文件", prompt: "帮我在桌面创建一个 todo.md，列出今天的任务" },
  { icon: "🌐", label: "搜索网页", prompt: "帮我搜索最新的 Python 3.13 特性并总结" },
  { icon: "📬", label: "处理邮件", prompt: "帮我看看收件箱有什么重要的邮件" },
  { icon: "📅", label: "管理日程", prompt: "我这周有什么日历日程？" },
  { icon: "🎯", label: "规划目标", prompt: "帮我设定一个本周目标并拆解步骤" },
  { icon: "🧠", label: "记住信息", prompt: "我想让你记住一些关于我的事情" },
];

function getSuggestionIcon(label: string) {
  for (const [key, meta] of Object.entries(SUGGESTION_META)) {
    if (label.includes(key)) return meta.icon;
  }
  return Zap;
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
  const handleVoiceTranscript = useCallback((transcript: string) => {
    setInput((prev) => (prev ? prev + " " + transcript : transcript));
    inputRef.current?.focus();
  }, []);
  const pendingPrompt = useChatStore((s) => s.pendingPrompt);
  const setPendingPrompt = useChatStore((s) => s.setPendingPrompt);

  // Server state lives in TanStack Query; cache is invalidated by WS
  // `memory_changed` events so we never need setTimeout polling.
  const { data: memData } = useMemoriesGroupedQuery();
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

  const adjustTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  useEffect(() => {
    if (pendingPrompt) {
      setInput(pendingPrompt);
      setPendingPrompt(null);
      adjustTextareaHeight();
    }
  }, [pendingPrompt, setPendingPrompt, adjustTextareaHeight]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

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
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-lg w-full text-center">
            <div className="text-4xl mb-4">🧠</div>
            <h2 className="text-xl font-semibold text-fg-primary mb-2">开始对话</h2>
            <p className="text-sm text-fg-tertiary mb-4">
              我是你的个人 AI 助手。所有数据保存在你的机器上，完全私有。
            </p>

            {/* 我记得你 —— 记忆驱动连续性 */}
            {recentMemories.length > 0 && (
              <div className="mb-5 text-left bg-insight/10 border border-insight/30 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-sm">🧠</span>
                  <span className="text-xs text-insight font-medium">我记得你</span>
                </div>
                <div className="space-y-1.5">
                  {recentMemories.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setInput(
                          `你记得我${m.category === "preference" ? "喜欢" : m.category === "fact" ? "" : "的"}「${m.content.slice(0, 60)}」，基于这个继续聊聊`,
                        );
                        adjustTextareaHeight();
                        setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                      className="block w-full text-left text-xs text-fg-secondary hover:text-insight transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
                      title={m.content}
                    >
                      · {m.content.slice(0, 60)}
                      {m.content.length > 60 ? "…" : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-1.5 mb-4">
              {CAPABILITY_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => {
                    setInput(c.prompt);
                    adjustTextareaHeight();
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-surface-overlay/60 hover:bg-surface-overlay text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  title={c.prompt}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-disabled mb-6">点击能力胶囊快速开始，或在下方直接输入</p>
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              {suggestions.map((s) => {
                const SIcon = getSuggestionIcon(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      adjustTextareaHeight();
                      setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 bg-surface-overlay hover:bg-border-strong text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <SIcon size={13} className="text-fg-secondary" />
                    <span>{s.length > 50 ? s.slice(0, 50) + "…" : s}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-border-subtle p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 items-end bg-surface-raised rounded-xl border border-border-strong focus-within:border-focus-ring transition-colors p-3">
              <VoiceInput
                onTranscript={handleVoiceTranscript}
                disabled={isLoading || !!pendingConfirmation}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onInput={adjustTextareaHeight}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                className="flex-1 bg-transparent border-none outline-none resize-none text-fg-primary placeholder:text-fg-tertiary min-h-[24px] max-h-[200px] py-1"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-4 py-2 bg-surface-overlay hover:bg-border-strong disabled:bg-surface-overlay disabled:text-fg-disabled rounded-lg text-sm font-medium text-white transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                发送
              </button>
            </div>
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
                      onClick={() => {
                        setInput(s);
                        adjustTextareaHeight();
                        inputRef.current?.focus();
                      }}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-surface-overlay hover:bg-border-strong text-fg-secondary hover:text-fg-primary rounded-full border border-border-subtle hover:border-border-strong transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      <SIcon size={12} className="text-fg-secondary" />
                      <span>{s.length > 50 ? s.slice(0, 50) + "…" : s}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-3 items-end bg-surface-raised rounded-xl border border-border-strong focus-within:border-focus-ring transition-colors p-3">
              <VoiceInput
                onTranscript={handleVoiceTranscript}
                disabled={isLoading || !!pendingConfirmation}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onInput={adjustTextareaHeight}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                className="flex-1 bg-transparent border-none outline-none resize-none text-fg-primary placeholder:text-fg-tertiary min-h-[24px] max-h-[200px] py-1"
                disabled={isLoading || !!pendingConfirmation}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim() || !!pendingConfirmation}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                  isLoading
                    ? "bg-surface-overlay/50 text-fg-secondary cursor-not-allowed"
                    : "bg-surface-overlay hover:bg-border-strong disabled:bg-surface-overlay disabled:text-fg-disabled text-white"
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    思考中
                  </span>
                ) : (
                  "发送"
                )}
              </button>
            </div>
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
