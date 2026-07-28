/** Shared chat tool-call types used by MessageItem / TaskTrack / ToolCallDisplay. */

export interface ToolCall {
  index: number;
  id: string;
  function_name: string;
  arguments: string;
}

export interface ToolResult {
  tool_name: string;
  tool_call_id: string;
  content: string;
}
