import { describe, expect, it } from "vitest";
import { matchResultsByCallId } from "./matchToolResult";
import type { ToolCall, ToolResult } from "./types";

const calls: ToolCall[] = [
  { index: 0, id: "tc-1", function_name: "read_file", arguments: "{}" },
  { index: 1, id: "tc-2", function_name: "read_file", arguments: "{}" },
];

describe("matchResultsByCallId", () => {
  it("matches strictly by tool_call_id for multi-step same-name tools", () => {
    const results: ToolResult[] = [
      { tool_name: "read_file", tool_call_id: "tc-1", content: "a" },
      { tool_name: "read_file", tool_call_id: "tc-2", content: "b" },
    ];
    const matched = matchResultsByCallId(calls, results);
    expect(matched[0]?.content).toBe("a");
    expect(matched[1]?.content).toBe("b");
  });

  it("does not cross-match when call ids are present", () => {
    const results: ToolResult[] = [
      { tool_name: "read_file", tool_call_id: "tc-2", content: "only-second" },
    ];
    const matched = matchResultsByCallId(calls, results);
    expect(matched[0]).toBeUndefined();
    expect(matched[1]?.content).toBe("only-second");
  });

  it("falls back to tool_name only for single call without call id", () => {
    const single: ToolCall[] = [
      { index: 0, id: "tc-1", function_name: "read_file", arguments: "{}" },
    ];
    const results: ToolResult[] = [{ tool_name: "read_file", tool_call_id: "", content: "ok" }];
    const matched = matchResultsByCallId(single, results);
    expect(matched[0]?.content).toBe("ok");
  });
});
