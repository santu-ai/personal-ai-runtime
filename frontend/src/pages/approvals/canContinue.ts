/**
 * Whether approving this item can continue the originating chat (one-shot resume).
 * Requires conversation id, tool call id, and a non-empty action name.
 */
export function canContinueApproval(item: {
  conversation_id?: string | null;
  tool_call_id?: string | null;
  action?: string | null;
}): boolean {
  return Boolean(item.conversation_id && item.tool_call_id && item.action);
}
