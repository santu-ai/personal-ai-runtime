import { describe, expect, it } from "vitest";
import type { MemoryProvenanceEvent } from "../../api/client";
import {
  PROVENANCE_REPAIR_PREVIEW,
  PROVENANCE_UPDATE_PREVIEW,
  eventDescription,
  provenanceSentence,
} from "./provenanceFormatting";

function event(
  type: string,
  payload: Record<string, unknown>,
  actor = "user",
): MemoryProvenanceEvent {
  return {
    seq: 1,
    type,
    ts: "2026-09-01T00:00:00Z",
    actor,
    payload,
    correlation_id: null,
  };
}

describe("provenanceSentence", () => {
  it("keeps a short update as one sentence that is not clipped", () => {
    const content = "住在上海";
    const line = provenanceSentence(event("MemoryUpdated", { content }));
    expect(line.preview).toBe("内容由 user 更新为「住在上海」");
    expect(line.full).toBe(line.preview);
    expect(eventDescription(event("MemoryUpdated", { content }))).toBe(line.preview);
  });

  it("clips an update at 60 characters and keeps the whole sentence", () => {
    const content = "记".repeat(PROVENANCE_UPDATE_PREVIEW);
    const exact = provenanceSentence(event("MemoryUpdated", { content }));
    expect(exact.preview).toBe(exact.full);
    expect(exact.full).toBe(`内容由 user 更新为「${content}」`);

    const longer = `${content}多`;
    const line = provenanceSentence(event("MemoryUpdated", { content: longer }));
    expect(line.preview).toBe(`内容由 user 更新为「${content}…」`);
    expect(line.full).toBe(`内容由 user 更新为「${longer}」`);
    expect(line.preview).not.toBe(line.full);
    expect(eventDescription(event("MemoryUpdated", { content: longer }))).toBe(line.preview);
  });

  it("leaves an update without text unclipped", () => {
    const line = provenanceSentence(event("MemoryUpdated", { content: "" }));
    expect(line.preview).toBe("内容被 user 更新");
    expect(line.full).toBe(line.preview);
    expect(provenanceSentence(event("MemoryUpdated", {})).preview).toBe(line.preview);
  });

  it("clips a repair error at 80 characters and keeps the whole reason", () => {
    const reason = "错".repeat(PROVENANCE_REPAIR_PREVIEW);
    const exact = provenanceSentence(event("MemoryIndexRepairFailed", { error: reason }));
    expect(exact.preview).toBe(exact.full);
    expect(exact.full).toBe(`向量索引修复失败：${reason}`);

    const longer = `${reason}还有`;
    const line = provenanceSentence(event("MemoryIndexRepairFailed", { error: longer }));
    expect(line.preview).toBe(`向量索引修复失败：${reason}…`);
    expect(line.full).toBe(`向量索引修复失败：${longer}`);
    expect(eventDescription(event("MemoryIndexRepairFailed", { error: longer }))).toBe(
      line.preview,
    );
  });

  it("keeps a missing repair error as the fallback sentence", () => {
    const line = provenanceSentence(event("MemoryIndexRepairFailed", { error: "" }));
    expect(line.preview).toBe("向量索引修复失败，记忆可能无法语义召回");
    expect(line.full).toBe(line.preview);
    expect(provenanceSentence(event("MemoryIndexRepairFailed", {})).full).toBe(line.full);
  });

  it("does not clip a derived sentence", () => {
    const line = provenanceSentence(event("MemoryDerived", { confidence: 0.9 }, "brain"));
    expect(line.preview).toBe("由 brain 抽取，置信度 0.90");
    expect(line.full).toBe(line.preview);
  });
});
