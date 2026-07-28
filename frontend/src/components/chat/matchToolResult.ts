import type { ToolCall, ToolResult } from "./types";

/**
 * Match tool results to tool calls by `tool_call_id`.
 *
 * Strict by default: only match when `result.tool_call_id === call.id`.
 * Fallback to `tool_name` only for the single-call / single-result case
 * where the result is missing a call id (legacy streaming payloads).
 */
export function matchResultsByCallId(
  calls: ToolCall[],
  results: ToolResult[],
): (ToolResult | undefined)[] {
  if (
    calls.length === 1 &&
    results.length === 1 &&
    !results[0].tool_call_id &&
    results[0].tool_name === calls[0].function_name
  ) {
    return [results[0]];
  }

  const used = new Set<number>();
  return calls.map((tc) => {
    const idx = results.findIndex(
      (r, i) => !used.has(i) && Boolean(tc.id) && r.tool_call_id === tc.id,
    );
    if (idx >= 0) {
      used.add(idx);
      return results[idx];
    }
    return undefined;
  });
}
