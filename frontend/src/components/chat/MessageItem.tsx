import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Copy, Check, Brain, Mail, Target, FileText } from "lucide-react";
import ToolCallDisplay from "./ToolCallDisplay";
import { CodeBlock } from "./CodeBlock";
import { stripToolMarkup } from "../../utils/stripToolMarkup";
import type { SourceCitation } from "../../api/types";

interface ToolCall {
  index: number;
  id: string;
  function_name: string;
  arguments: string;
}

interface ToolResult {
  tool_name: string;
  tool_call_id: string;
  content: string;
}

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

function formatTimeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function InlineCode({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [text],
  );

  return (
    <code className="relative group bg-surface-overlay px-1.5 py-0.5 rounded text-sm text-insight">
      {children}
      <button
        type="button"
        onClick={handleCopy}
        className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-surface-overlay hover:bg-border-strong rounded p-0.5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        title="复制"
      >
        {copied ? (
          <Check size={10} className="text-success" />
        ) : (
          <Copy size={10} className="text-fg-secondary" />
        )}
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

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${colorMap[source.type] || "bg-surface-overlay text-fg-primary border-border-strong"}`}
      title={source.title}
    >
      {iconMap[source.type] || null}
      <span className="truncate max-w-[120px]">{source.title || labelMap[source.type]}</span>
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

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-sm">🧠</span>
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-surface-overlay text-white rounded-br-md"
            : "bg-surface-raised text-fg-primary rounded-bl-md"
        }`}
      >
        {/* Tool calls display */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallDisplay
            toolCalls={message.toolCalls}
            toolResults={message.toolResults || []}
            defaultExpanded={message.expandTools ?? false}
          />
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
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || "");
                      const codeStr = String(children).replace(/\n$/, "");

                      if (match) {
                        const nodeProps = props as Record<string, unknown>;
                        const inline = nodeProps.inline as boolean | undefined;
                        if (inline) {
                          return <InlineCode>{children}</InlineCode>;
                        }
                        return <CodeBlock language={match[1]} code={codeStr} />;
                      }

                      if (!className && String(children).length < 50) {
                        return <InlineCode>{children}</InlineCode>;
                      }

                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {displayContent}
                </ReactMarkdown>
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
          <div className={`text-xs mt-2 ${isUser ? "text-fg-tertiary" : "text-fg-tertiary"}`}>
            {formatTimeAgo(message.created_at)}
          </div>
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
