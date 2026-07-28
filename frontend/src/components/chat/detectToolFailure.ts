import type { ToolResult } from "./types";

export type ToolOutcome = "done" | "failed" | "running";

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
