import { describe, expect, it } from "vitest";
import { matchPersistedConfirmation } from "./matchPersistedConfirmation";
import type { DisplayMessage } from "./useChatMessages";
import type { EnrichedApproval } from "../api/types";

function approval(partial: Partial<EnrichedApproval> & { id: string }): EnrichedApproval {
  return {
    action: "write_file",
    status: "pending",
    flow_type: "对话",
    flow_label: "测试对话",
    correlation_id: "c1",
    conversation_id: "conv-1",
    tool_call_id: "tc-1",
    params: JSON.stringify({ path: "/tmp/x" }),
    ...partial,
  };
}

function assistant(toolCallId = "tc-1", withResult = false): DisplayMessage {
  return {
    id: "asst-1",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        index: 0,
        id: toolCallId,
        function_name: "write_file",
        arguments: JSON.stringify({ path: "/tmp/x", content: "hi" }),
      },
    ],
    toolResults: withResult
      ? [{ tool_name: "write_file", tool_call_id: toolCallId, content: '{"ok":true}' }]
      : undefined,
  };
}

describe("matchPersistedConfirmation", () => {
  it("matches an unanswered tool call to the pending approval", () => {
    const matched = matchPersistedConfirmation(
      [{ id: "u1", role: "user", content: "写文件" }, assistant()],
      [approval({ id: "ap-1" })],
      "conv-1",
    );
    expect(matched?.assistantMsgId).toBe("asst-1");
    expect(matched?.event).toEqual({
      tool_name: "write_file",
      approval_id: "ap-1",
      tool_call_id: "tc-1",
      tool_args: { path: "/tmp/x", content: "hi" },
    });
  });

  it("ignores tool calls that already have results", () => {
    expect(
      matchPersistedConfirmation([assistant("tc-1", true)], [approval({ id: "ap-1" })], "conv-1"),
    ).toBeNull();
  });

  it("ignores approvals for another conversation", () => {
    expect(
      matchPersistedConfirmation(
        [assistant()],
        [approval({ id: "ap-1", conversation_id: "other" })],
        "conv-1",
      ),
    ).toBeNull();
  });
});
