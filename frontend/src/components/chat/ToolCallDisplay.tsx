import { useState, type ReactNode } from "react";
import { toolLabel, toolIcon, describeToolAction } from "../../utils/toolLabels";
import { matchResultsByCallId } from "./matchToolResult";
import { detectOutcome } from "./detectToolFailure";
import { formatArgs } from "./formatArgs";
import type { ToolCall, ToolResult } from "./types";

interface EmailItem {
  from: string;
  subject: string;
  date: string;
  preview: string;
}

interface Props {
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  /** When true, expand tool panels that already have results (e.g. after page reload). */
  defaultExpanded?: boolean;
}

function emailSortKey(dateStr: string): number {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortEmailsNewestFirst(emails: EmailItem[]): EmailItem[] {
  return [...emails].sort((a, b) => emailSortKey(b.date) - emailSortKey(a.date));
}

function parseInboxResult(content: string): { count: number; emails: EmailItem[] } | null {
  if (!content?.trim()) return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed.error || !Array.isArray(parsed.emails)) return null;
    const emails = sortEmailsNewestFirst(parsed.emails);
    return { count: parsed.count ?? emails.length, emails };
  } catch {
    return null;
  }
}

function shortenFrom(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const emailOnly = from.match(/<([^>]+)>/);
  if (emailOnly) return emailOnly[1];
  return from.length > 40 ? from.slice(0, 40) + "…" : from;
}

/** Normalize RFC / ISO dates to YYYY-MM-DD HH:mm (also handles legacy stored results). */
function formatEmailDate(dateStr: string): string {
  if (!dateStr) return "—";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 16);
  }
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} ${h}:${min}`;
  }
  return dateStr.length > 24 ? dateStr.slice(0, 24) + "…" : dateStr;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanPreview(text: string): string {
  if (!text) return "";
  let s = decodeHtmlEntities(text);
  if (/<[a-z][\s\S]*>/i.test(s)) {
    s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    s = s.replace(/<[^>]+>/g, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function InboxResultView({ data }: { data: { count: number; emails: EmailItem[] } }) {
  return (
    <div className="space-y-2">
      <div className="text-fg-secondary text-xs">共 {data.count} 封邮件</div>
      <div className="overflow-x-auto rounded border border-border-strong">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="bg-surface-overlay text-fg-secondary">
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">时间</th>
              <th className="px-2 py-1.5 font-medium">发件人</th>
              <th className="px-2 py-1.5 font-medium">主题</th>
            </tr>
          </thead>
          <tbody>
            {data.emails.map((em, i) => (
              <tr key={i} className="border-t border-border-strong/80 hover:bg-surface-overlay/50">
                <td className="px-2 py-1.5 text-fg-tertiary whitespace-nowrap align-top">
                  {formatEmailDate(em.date)}
                </td>
                <td
                  className="px-2 py-1.5 text-fg-primary align-top max-w-[120px] truncate"
                  title={em.from}
                >
                  {shortenFrom(em.from)}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <div className="text-fg-primary font-medium">{em.subject || "(无主题)"}</div>
                  {em.preview && (
                    <div className="text-fg-tertiary mt-0.5 line-clamp-2">
                      {cleanPreview(em.preview)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatResult(content: string, toolName: string): ReactNode {
  if (toolName === "check_inbox") {
    const inbox = parseInboxResult(content);
    if (inbox) return <InboxResultView data={inbox} />;
  }
  try {
    const parsed = JSON.parse(content);
    return (
      <pre className="bg-surface-sunken p-2 rounded text-fg-primary overflow-x-auto">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  } catch {
    const text = content.length > 500 ? content.slice(0, 500) + "\n... [truncated]" : content;
    return (
      <pre className="bg-surface-sunken p-2 rounded text-fg-primary overflow-x-auto">{text}</pre>
    );
  }
}

function getToolIcon(name: string): string {
  return toolIcon(name);
}

export default function ToolCallDisplay({
  toolCalls,
  toolResults,
  defaultExpanded = false,
}: Props) {
  const matchedResults = matchResultsByCallId(toolCalls, toolResults);
  const hasAllResults = matchedResults.every(Boolean);
  const [expandedCall, setExpandedCall] = useState<number | null>(
    defaultExpanded && hasAllResults ? 0 : null,
  );

  if (toolCalls.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {toolCalls.map((tc, idx) => {
        const result = matchedResults[idx];
        const outcome = detectOutcome(result);
        const isExpanded = expandedCall === idx;
        const inboxData =
          tc.function_name === "check_inbox" && result ? parseInboxResult(result.content) : null;
        const showInboxInline = Boolean(inboxData);

        let argsSummary = "";
        try {
          argsSummary = describeToolAction(tc.function_name, JSON.parse(tc.arguments || "{}"));
        } catch {
          /* keep empty */
        }

        return (
          <div
            key={tc.id || idx}
            className="bg-surface-raised/60 rounded-lg border border-border-strong overflow-hidden"
          >
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setExpandedCall(isExpanded ? null : idx)}
              className="w-full text-left px-3 py-2 text-xs text-fg-secondary hover:text-fg-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <span>{getToolIcon(tc.function_name)}</span>
              <span className="text-fg-primary font-medium">{toolLabel(tc.function_name)}</span>
              {argsSummary && <span className="text-fg-tertiary ml-1.5">{argsSummary}</span>}
              {outcome === "done" ? (
                <span className="float-right text-success mt-0.5">✓ 完成</span>
              ) : outcome === "failed" ? (
                <span className="float-right text-danger mt-0.5">✗ 失败</span>
              ) : (
                <span className="float-right flex items-center gap-1 mt-0.5">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
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
                  执行中
                </span>
              )}
              <svg
                className={`float-right w-3 h-3 transition-transform mt-0.5 ml-1.5 ${isExpanded ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {showInboxInline && inboxData && (
              <div className="border-t border-border-strong px-3 py-2">
                <InboxResultView data={inboxData} />
              </div>
            )}

            {isExpanded && !showInboxInline && (
              <div className="border-t border-border-strong px-3 py-2 space-y-2 text-xs">
                <div>
                  <div className="text-fg-tertiary mb-1">参数</div>
                  <pre className="bg-surface-sunken p-2 rounded text-fg-primary overflow-x-auto">
                    {formatArgs(tc.arguments)}
                  </pre>
                </div>
                {result && (
                  <div>
                    <div className="text-fg-tertiary mb-1">结果</div>
                    <div className="max-h-64 overflow-y-auto">
                      {formatResult(result.content, tc.function_name)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
