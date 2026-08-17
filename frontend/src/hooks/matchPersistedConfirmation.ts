import type { EnrichedApproval } from "../api/types";
import type { DisplayMessage } from "./useChatMessages";

export interface PersistedConfirmationEvent {
  tool_name: string;
  approval_id: string;
  tool_args: Record<string, unknown>;
  tool_call_id: string;
}

export interface PersistedConfirmation {
  assistantMsgId: string;
  event: PersistedConfirmationEvent;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Rebuild an inline confirmation from persisted tool_calls + pending approvals.
 * Used after reload so a needs_user interrupt does not disappear.
 */
export function matchPersistedConfirmation(
  messages: DisplayMessage[],
  approvals: EnrichedApproval[],
  conversationId: string,
): PersistedConfirmation | null {
  const pending = approvals.filter(
    (a) =>
      a.status === "pending" &&
      a.conversation_id === conversationId && Boolean(a.tool_call_id),
  );
  if (pending.length === 0) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.toolCalls?.length) continue;
    const results = msg.toolResults ?? [];
    for (const tc of msg.toolCalls) {
      if (results.some((r) => r.tool_call_id === tc.id)) continue;
      const approval = pending.find((a) => a.tool_call_id === tc.id);
      if (!approval) continue;
      const toolArgs = parseArgs(tc.arguments) || parseArgs(approval.params);
      return {
        assistantMsgId: msg.id,
        event: {
          tool_name: tc.function_name,
          approval_id: approval.id,
          tool_args: Object.keys(toolArgs).length ? toolArgs : parseArgs(approval.params),
          tool_call_id: tc.id,
        },
      };
    }
  }
  return null;
}
