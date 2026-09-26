import { describe, expect, it } from "vitest";
import {
  freshToolOutcomePhrase,
  settledToolOutcomes,
  type ToolOutcomeMessage,
} from "./detectToolFailure";

function message(
  id: string,
  calls: Array<{ id: string; name: string }>,
  results: Array<{ id: string; name: string; content: string }>,
): ToolOutcomeMessage {
  return {
    id,
    toolCalls: calls.map((call, index) => ({
      index,
      id: call.id,
      function_name: call.name,
      arguments: "{}",
    })),
    toolResults: results.map((result) => ({
      tool_call_id: result.id,
      tool_name: result.name,
      content: result.content,
    })),
  };
}

describe("settledToolOutcomes", () => {
  it("names a finished step the same way as the button", () => {
    const rows = settledToolOutcomes([
      message(
        "a1",
        [{ id: "tc-1", name: "read_file" }],
        [{ id: "tc-1", name: "read_file", content: '{"ok":true}' }],
      ),
    ]);
    expect(rows).toEqual([{ key: "a1:tc-1:done", phrase: "「读取文件」完成。" }]);
  });

  it("names a failed step and skips a step that is still running", () => {
    const rows = settledToolOutcomes([
      message(
        "a1",
        [
          { id: "tc-1", name: "web_search" },
          { id: "tc-2", name: "read_file" },
        ],
        [{ id: "tc-1", name: "web_search", content: '{"error":"nope"}' }],
      ),
    ]);
    expect(rows).toEqual([{ key: "a1:tc-1:failed", phrase: "「搜索网页」失败。" }]);
  });

  it("skips an empty result and a denial", () => {
    const rows = settledToolOutcomes([
      message(
        "a1",
        [
          { id: "tc-1", name: "read_file" },
          { id: "tc-2", name: "write_file" },
        ],
        [
          { id: "tc-1", name: "read_file", content: "   " },
          { id: "tc-2", name: "write_file", content: '{"status":"denied"}' },
        ],
      ),
    ]);
    expect(rows).toEqual([]);
  });

  it("joins only the steps that were not read yet", () => {
    const current = settledToolOutcomes([
      message(
        "a1",
        [
          { id: "tc-1", name: "read_file" },
          { id: "tc-2", name: "web_search" },
        ],
        [
          { id: "tc-1", name: "read_file", content: '{"ok":true}' },
          { id: "tc-2", name: "web_search", content: "failed: down" },
        ],
      ),
    ]);
    expect(freshToolOutcomePhrase(new Set(["a1:tc-1:done"]), current)).toBe("「搜索网页」失败。");
    expect(freshToolOutcomePhrase(new Set(current.map((row) => row.key)), current)).toBeNull();
    expect(freshToolOutcomePhrase(new Set(), current)).toBe("「读取文件」完成。「搜索网页」失败。");
  });
});
