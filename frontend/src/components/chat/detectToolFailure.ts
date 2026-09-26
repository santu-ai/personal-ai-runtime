import { toolLabel } from "../../utils/toolLabels";
import { matchResultsByCallId } from "./matchToolResult";
import type { ToolCall, ToolResult } from "./types";

export type ToolOutcome = "done" | "failed" | "running";

export interface ToolOutcomeMessage {
  id: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface SettledToolOutcome {
  key: string;
  phrase: string;
}

const TEXT_FAILURE_PREFIXES = [/^error\b/i, /^traceback\b/i, /^exception\b/i, /^failed\b/i];

function isFailedContent(content: string): boolean {
  if (!content?.trim()) return false;

  try {
    const parsed = JSON.parse(content);
    return Boolean(parsed?.error || parsed?.status === "denied" || parsed?.status === "error");
  } catch {
    const trimmed = content.trim();
    return TEXT_FAILURE_PREFIXES.some((re) => re.test(trimmed));
  }
}

/** Derive display outcome for a tool stage from its optional result. */
export function detectOutcome(result?: ToolResult): ToolOutcome {
  if (!result) return "running";
  // Empty content typically means streaming has not finished; keep as running.
  if (!result.content?.trim()) return "running";
  return isFailedContent(result.content) ? "failed" : "done";
}

function isUserDenied(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as { status?: unknown };
    return parsed?.status === "denied";
  } catch {
    return false;
  }
}

/** 和这一步按钮上的中文名字相同。完成或失败各一句。 */
export function toolOutcomePhrase(name: string, outcome: "done" | "failed"): string {
  const label = toolLabel(name).trim() || "该操作";
  return outcome === "done" ? `「${label}」完成。` : `「${label}」失败。`;
}

/** 已经写出结果、且不是用户拒绝的那些步。执行中和空结果不算。 */
export function settledToolOutcomes(messages: readonly ToolOutcomeMessage[]): SettledToolOutcome[] {
  const rows: SettledToolOutcome[] = [];
  for (const message of messages) {
    const calls = message.toolCalls ?? [];
    if (calls.length === 0) continue;
    const matched = matchResultsByCallId(calls, message.toolResults ?? []);
    calls.forEach((call, index) => {
      const result = matched[index];
      if (!result || isUserDenied(result.content)) return;
      const outcome = detectOutcome(result);
      if (outcome === "running") return;
      const id = call.id.trim() || `index-${index}`;
      rows.push({
        key: `${message.id}:${id}:${outcome}`,
        phrase: toolOutcomePhrase(call.function_name || result.tool_name, outcome),
      });
    });
  }
  return rows;
}

/** 这一轮新出现的几步合成一句。已经读过的不再放进来。 */
export function freshToolOutcomePhrase(
  seen: ReadonlySet<string>,
  current: readonly SettledToolOutcome[],
): string | null {
  const fresh = current.filter((row) => !seen.has(row.key));
  if (fresh.length === 0) return null;
  return fresh.map((row) => row.phrase).join("");
}
