import { useState, useCallback, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, Brain, Mail, Target, FileText } from "lucide-react";
import ToolCallDisplay from "./ToolCallDisplay";
import TaskTrack from "./TaskTrack";
import { CodeBlock } from "./CodeBlock";
import { LazyMarkdown } from "./LazyMarkdown";
import { stripToolMarkup } from "../../utils/stripToolMarkup";
import { isImeKeyboardEvent } from "../../utils/imeKey";
import { timeAgo } from "../../utils/timeUtils";
import { matchResultsByCallId } from "./matchToolResult";
import type { ToolCall, ToolResult } from "./types";
import type { SourceCitation } from "../../api/types";

interface DisplayMessage {
  id: string;
  role: string;
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  expandTools?: boolean;
  created_at?: string;
  sources?: SourceCitation[];
}

interface Props {
  message: DisplayMessage;
}

const BLOCKED_LINK_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:", "file:"]);
const focusRing =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

/** 超过这么多个字，行内代码会把后面顶出气泡，只能横向滚。 */
const INLINE_CODE_CHARS = 80;

/** 空格和回车不把页面滚走，也不触发旁边的「复制」。组字或输入法处理键时这一下不拦住。 */
function keepInlineCodeKeysFromScrolling(event: KeyboardEvent<HTMLElement>) {
  if (event.target !== event.currentTarget) return;
  if (isImeKeyboardEvent(event.nativeEvent)) return;
  if (event.key === "Enter" || event.key === " ") event.preventDefault();
}

export function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) {
    return <span>{children}</span>;
  }
  let parsed: URL;
  try {
    parsed = new URL(href, window.location.href);
  } catch {
    return <span>{children}</span>;
  }
  if (BLOCKED_LINK_PROTOCOLS.has(parsed.protocol)) {
    return <span>{children}</span>;
  }
  if (parsed.origin === window.location.origin) {
    return (
      <Link to={`${parsed.pathname}${parsed.search}${parsed.hash}`} className={focusRing}>
        {children}
      </Link>
    );
  }
  if (
    parsed.protocol === "http:" ||
    parsed.protocol === "https:" ||
    parsed.protocol === "mailto:"
  ) {
    return (
      <a href={parsed.href} target="_blank" rel="noopener noreferrer" className={focusRing}>
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

function InlineCode({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      if (!write) return;
      // 失败时不写成已复制，也不让未接住的拒绝冒到控制台。
      void write(text).then(
        () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        },
        () => {
          setCopied(false);
        },
      );
    },
    [text],
  );

  const copyLabel = copied ? "已复制" : "复制";
  const reveal = text.length > INLINE_CODE_CHARS;

  return (
    <code className="relative group bg-surface-overlay px-1.5 py-0.5 rounded text-sm text-insight">
      {reveal ? (
        // 焦点落在正文上，不落在整颗 code 上，避免把「复制」当成这一段自己的焦点。
        <span
          tabIndex={0}
          data-inline-code=""
          title={text}
          onKeyDown={keepInlineCodeKeysFromScrolling}
          className="focus-visible:overflow-visible focus-visible:whitespace-pre-wrap focus-visible:break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring group-has-[:focus-visible]:overflow-visible group-has-[:focus-visible]:whitespace-pre-wrap group-has-[:focus-visible]:break-all"
        >
          {/* 超过 80 个字时平时可能横向溢出。键盘落到时写出整段并换行。鼠标悬停仍不换行，整段在 title 里。 */}
          {children}
        </span>
      ) : (
        children
      )}
      <button
        type="button"
        onClick={handleCopy}
        // 只在悬停时出现的话，键盘落到这一钮时整颗都是透明的，焦点环也看不见。
        className="group absolute -top-1 -right-1 inline-flex max-w-full items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-surface-overlay hover:bg-border-strong rounded p-0.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? (
          <Check
            size={10}
            aria-hidden
            className="shrink-0 text-success group-focus-visible:hidden"
          />
        ) : (
          <Copy
            size={10}
            aria-hidden
            className="shrink-0 text-fg-secondary group-focus-visible:hidden"
          />
        )}
        <span
          data-icon-name=""
          className="hidden whitespace-nowrap text-center text-[10px] leading-tight group-focus-visible:block"
        >
          {copyLabel}
        </span>
      </button>
    </code>
  );
}

function SourceBadge({ source }: { source: SourceCitation }) {
  const iconMap = {
    memory: <Brain size={10} />,
    email: <Mail size={10} />,
    goal: <Target size={10} />,
    document: <FileText size={10} />,
  };
  const colorMap = {
    memory: "bg-insight/15 text-insight border-insight/30",
    email: "bg-warning/15 text-warning border-warning/30",
    goal: "bg-success/15 text-success border-success/30",
    document: "bg-insight/15 text-insight border-insight/30",
  };
  const labelMap = {
    memory: "记忆",
    email: "邮件",
    goal: "目标",
    document: "文档",
  };

  const titled = Boolean(source.title);
  const keepFromScrolling = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (isImeKeyboardEvent(event.nativeEvent)) return;
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
  };
  return (
    <span
      tabIndex={titled ? 0 : undefined}
      title={source.title || undefined}
      onKeyDown={titled ? keepFromScrolling : undefined}
      className={`group inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
        colorMap[source.type] || "bg-surface-overlay text-fg-primary border-border-strong"
      }${
        titled
          ? " focus-visible:items-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          : ""
      }`}
    >
      {iconMap[source.type] || null}
      {/* 平时最多约 120px，整句在悬停 title 里。键盘落到时写出整句。 */}
      <span
        className={
          titled
            ? "min-w-0 max-w-[120px] truncate group-focus-visible:max-w-full group-focus-visible:overflow-visible group-focus-visible:whitespace-normal group-focus-visible:text-clip group-focus-visible:break-words"
            : "max-w-[120px] truncate"
        }
      >
        {source.title || labelMap[source.type]}
      </span>
    </span>
  );
}

function ThinkingPlaceholder() {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-secondary py-0.5">
      <span className="inline-flex gap-1">
        <span
          className="w-1.5 h-1.5 bg-fg-tertiary rounded-full animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1.5 h-1.5 bg-fg-tertiary rounded-full animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <span
          className="w-1.5 h-1.5 bg-fg-tertiary rounded-full animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </span>
      <span className="animate-pulse">思考中…</span>
    </div>
  );
}

const markdownComponents = {
  a: MarkdownLink,
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const match = /language-(\w+)/.exec(className || "");
    const raw = String(children ?? "");
    const codeStr = raw.replace(/\n$/, "");

    // 带语言，或正文里有换行，是成段代码。行内那颗复制盖不住这一块。
    if (match || raw.includes("\n")) {
      return <CodeBlock language={match?.[1] ?? "text"} code={codeStr} />;
    }

    // 没有语言标记、正文里也没有换行，不论长短都是行内代码。
    // 长过 50 个字符的原先落回纯文本，键盘和鼠标都复制不了。
    if (!className) {
      return <InlineCode>{children}</InlineCode>;
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export default function MessageItem({ message }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";
  const isTool = message.role === "tool";

  const displayContent = isAssistant
    ? stripToolMarkup(message.content, { trim: message.isStreaming ? false : undefined })
    : message.content;

  if (isSystem || isTool) return null;

  // Tool-loop intermediate turns: empty assistant text with no toolCalls —
  // skip the hollow avatar+bubble (content may still stream later).
  const hasTools = Boolean(message.toolCalls && message.toolCalls.length > 0);
  if (
    isAssistant &&
    !message.isStreaming &&
    !displayContent.trim() &&
    !hasTools &&
    !(message.sources && message.sources.length > 0)
  ) {
    return null;
  }

  // When the assistant turn has started (isStreaming) but produced no
  // visible text or tool calls yet — typically during LLM reasoning or
  // before the first token arrives — render an explicit "thinking" state
  // so the user sees the turn is in flight, not stalled or finished.
  const isThinking = isAssistant && message.isStreaming && !displayContent.trim() && !hasTools;

  // Pre-compute tool call stages for TaskTrack (avoid IIFE in JSX)
  const taskStages =
    hasTools && message.toolCalls
      ? (() => {
          const matched = matchResultsByCallId(message.toolCalls, message.toolResults || []);
          return message.toolCalls.map((tc, i) => ({ toolCall: tc, result: matched[i] }));
        })()
      : [];

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {isAssistant && (
        <div
          className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center shrink-0 mt-0.5"
          aria-label="助手"
        >
          <Brain size={16} className="text-insight" />
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-insight-strong/90 text-fg-on-accent rounded-br-md shadow-sm"
            : "bg-surface-raised text-fg-primary border border-border-subtle rounded-bl-md shadow-sm"
        }`}
      >
        {/* Tool calls display: 多步用 TaskTrack，单步退化为 ToolCallDisplay */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <>
            {message.toolCalls.length > 1 ? (
              <TaskTrack stages={taskStages} />
            ) : (
              <ToolCallDisplay
                toolCalls={message.toolCalls}
                toolResults={message.toolResults || []}
                defaultExpanded={message.expandTools ?? false}
              />
            )}
          </>
        )}

        {/* Thinking placeholder: assistant turn in flight, no tokens yet */}
        {isThinking && <ThinkingPlaceholder />}

        {/* Message content */}
        {displayContent && (
          <div className={message.isStreaming ? "typing-cursor" : ""}>
            {isUser ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayContent}</p>
            ) : (
              <div className="markdown-content text-sm leading-relaxed prose-p:my-0">
                <LazyMarkdown content={displayContent} components={markdownComponents} />
                {message.isStreaming && (
                  <span className="inline-flex gap-0.5 ml-1 align-middle">
                    <span
                      className="w-1.5 h-1.5 bg-fg-tertiary rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-fg-tertiary rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-fg-tertiary rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        {message.created_at && (
          <div className="text-xs mt-2 text-fg-tertiary">{timeAgo(message.created_at)}</div>
        )}

        {/* Source citations — memory + document references */}
        {isAssistant && message.sources && message.sources.length > 0 && !message.isStreaming && (
          <div className="mt-3 pt-2 border-t border-border-strong/50">
            <div className="flex items-center gap-1.5 text-xs text-insight font-medium mb-2">
              <Brain size={12} />
              <span>
                {message.sources.some((s) => s.type === "document") ? "参考来源" : "我记得"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((source, idx) => (
                <SourceBadge key={`${source.id}-${idx}`} source={source} />
              ))}
            </div>
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-sm text-white font-medium">你</span>
        </div>
      )}
    </div>
  );
}
