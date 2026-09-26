import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { getMemoryProvenance, type MemoryProvenanceEvent, type MemoryRow } from "../../api/client";
import MemoryProvenanceDialog from "./MemoryProvenanceDialog";
import { PROVENANCE_REPAIR_PREVIEW, PROVENANCE_UPDATE_PREVIEW } from "./provenanceFormatting";

vi.mock("../../api/client", () => ({
  getMemoryProvenance: vi.fn(),
}));

vi.mock("../../stores/errorStore", () => ({
  useErrorStore: (selector: (s: { addError: () => void }) => unknown) =>
    selector({ addError: vi.fn() }),
}));

const target: MemoryRow = { id: "m1", content: "喜欢早起跑步" };

function row(type: string, payload: Record<string, unknown>, seq = 1): MemoryProvenanceEvent {
  return {
    seq,
    type,
    ts: "2026-09-01T00:00:00Z",
    actor: "user",
    payload,
    correlation_id: null,
  };
}

async function openChain(events: MemoryProvenanceEvent[]) {
  vi.mocked(getMemoryProvenance).mockResolvedValue({ memory_id: "m1", events });
  render(<MemoryProvenanceDialog target={target} onClose={vi.fn()} />);
  expect(await screen.findByRole("dialog", { name: "记忆来源链" })).toBeInTheDocument();
}

describe("MemoryProvenanceDialog provenance lines", () => {
  it("writes the full update when that line is keyboard focused", async () => {
    const content = `${"记".repeat(PROVENANCE_UPDATE_PREVIEW)}后面还有`;
    const preview = `内容由 user 更新为「${"记".repeat(PROVENANCE_UPDATE_PREVIEW)}…」`;
    const full = `内容由 user 更新为「${content}」`;
    await openChain([
      row("MemoryUpdated", { content }),
      row("MemoryDerived", { confidence: 0.9 }, 2),
    ]);

    const line = screen.getByText(preview).closest("[data-provenance-preview]");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).toHaveAttribute("title", full);
    expect(line).toHaveClass(
      "group",
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
    const shown = line?.querySelector(".group-focus-visible\\:hidden");
    expect(shown).toHaveTextContent(preview);
    expect(shown?.className).not.toContain("group-hover:");
    const revealed = line?.querySelector(".group-focus-visible\\:block");
    expect(revealed).toHaveTextContent(full);
    expect(revealed).toHaveClass("hidden", "whitespace-pre-wrap", "break-words");
    expect(revealed?.className).not.toContain("group-hover:");

    expect(fireEvent.keyDown(line!, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(line!, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(line!, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(line!, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(line!, { key: "Process" })).toBe(true);
    expect(fireEvent.keyDown(line!, { key: " ", keyCode: 229 })).toBe(true);

    const derived = screen.getByText("由 user 抽取，置信度 0.90");
    expect(derived.closest("[data-provenance-preview]")).toBeNull();
    expect(derived).not.toHaveAttribute("tabindex");
  });

  it("writes the full repair reason when that line is keyboard focused and leaves a short one alone", async () => {
    const reason = `${"错".repeat(PROVENANCE_REPAIR_PREVIEW)}还没完`;
    const preview = `向量索引修复失败：${"错".repeat(PROVENANCE_REPAIR_PREVIEW)}…`;
    const full = `向量索引修复失败：${reason}`;
    await openChain([
      row("MemoryIndexRepairFailed", { error: reason }),
      row("MemoryIndexRepairFailed", { error: "索引锁住了" }, 2),
      row("MemoryUpdated", { content: "短更新" }, 3),
    ]);

    const line = screen.getByText(preview).closest("[data-provenance-preview]");
    expect(line).toHaveAttribute("tabindex", "0");
    expect(line).toHaveAttribute("title", full);
    expect(line?.querySelector(".group-focus-visible\\:block")).toHaveTextContent(full);
    expect(line?.querySelector(".group-focus-visible\\:hidden")?.className).not.toContain(
      "group-hover:",
    );

    const shortRepair = screen.getByText("向量索引修复失败：索引锁住了");
    expect(shortRepair.closest("[data-provenance-preview]")).toBeNull();
    expect(shortRepair).not.toHaveAttribute("tabindex");
    const shortUpdate = screen.getByText("内容由 user 更新为「短更新」");
    expect(shortUpdate.closest("[data-provenance-preview]")).toBeNull();
  });
});
