import { describe, expect, it } from "vitest";
import { executionStatusLabel, handlerLabel } from "./handlerLabels";

describe("handlerLabel", () => {
  it("uses the same Chinese names as the timer list", () => {
    expect(handlerLabel("morning_brief")).toBe("早安简报");
    expect(handlerLabel("inbox_poll")).toBe("收件箱拉取");
    expect(handlerLabel("memory_decay")).toBe("记忆衰减");
    expect(handlerLabel(" on_execute_requested ")).toBe("执行任务");
    expect(handlerLabel("handle_execute")).toBe("执行任务");
  });

  it("keeps an unknown name and drops a blank one", () => {
    expect(handlerLabel("custom_handler")).toBe("custom_handler");
    expect(handlerLabel("")).toBe("");
    expect(handlerLabel("   ")).toBe("");
    expect(handlerLabel(null)).toBe("");
  });
});

describe("executionStatusLabel", () => {
  it("matches the task status words and names a retry", () => {
    expect(executionStatusLabel("pending")).toBe("待执行");
    expect(executionStatusLabel("running")).toBe("运行中");
    expect(executionStatusLabel("failed")).toBe("失败");
    expect(executionStatusLabel("completed")).toBe("已完成");
    expect(executionStatusLabel("cancelled")).toBe("已取消");
    expect(executionStatusLabel("retrying")).toBe("重试中");
    expect(executionStatusLabel(" in_retry ")).toBe("重试中");
  });

  it("keeps an unknown status and drops a blank one", () => {
    expect(executionStatusLabel("interrupted")).toBe("interrupted");
    expect(executionStatusLabel("")).toBe("");
    expect(executionStatusLabel(undefined)).toBe("");
  });
});
