import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithRouter } from "../../test-utils";
import MemoryListItem from "./MemoryListItem";
import type { MemoryRow } from "../../api/client";

const noop = () => {};

function renderItem(memory: MemoryRow) {
  const onRatify = vi.fn();
  const onReject = vi.fn();
  renderWithRouter(
    <ul>
      <MemoryListItem
        memory={memory}
        onRatify={onRatify}
        onReject={onReject}
        onEdit={noop}
        onDelete={noop}
        onContinueChat={noop}
        onShowProvenance={noop}
      />
    </ul>,
  );
  return { onRatify, onReject };
}

describe("MemoryListItem", () => {
  it("always shows confirm/reject and confidence for proposed claims", () => {
    renderItem({
      id: "m1",
      content: "喜欢早起跑步",
      origin: "claim",
      claim_status: "proposed",
      confidence: 0.86,
      created_at: new Date().toISOString(),
    });
    expect(screen.getByText("置信度 86%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /确认/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /拒绝/ })).toBeVisible();
  });

  it("keeps confirm enabled and busy while that row is ratifying", () => {
    const onRatify = vi.fn();
    const onReject = vi.fn();
    renderWithRouter(
      <ul>
        <MemoryListItem
          memory={{
            id: "m1",
            content: "喜欢早起跑步",
            origin: "claim",
            claim_status: "proposed",
          }}
          ratifying
          onRatify={onRatify}
          onReject={onReject}
          onEdit={noop}
          onDelete={noop}
          onContinueChat={noop}
          onShowProvenance={noop}
        />
      </ul>,
    );
    const confirm = screen.getByRole("button", { name: "确认：喜欢早起跑步" });
    confirm.focus();
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toHaveClass("opacity-50");
    expect(confirm).toHaveFocus();
    const reject = screen.getByRole("button", { name: "拒绝：喜欢早起跑步" });
    expect(reject).toBeEnabled();
    expect(reject).not.toHaveAttribute("aria-busy");
    fireEvent.click(reject);
    expect(onReject).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(onRatify).toHaveBeenCalledTimes(1);
  });

  it("keeps restore enabled while that row is ratifying", () => {
    renderWithRouter(
      <ul>
        <MemoryListItem
          memory={{
            id: "m2",
            content: "从不喝咖啡",
            origin: "claim",
            claim_status: "rejected",
            reject_reason: "记错了",
          }}
          ratifying
          onRatify={noop}
          onReject={noop}
          onEdit={noop}
          onDelete={noop}
          onContinueChat={noop}
          onShowProvenance={noop}
        />
      </ul>,
    );
    const restore = screen.getByRole("button", { name: "恢复：从不喝咖啡" });
    restore.focus();
    expect(restore).toBeEnabled();
    expect(restore).toHaveAttribute("aria-busy", "true");
    expect(restore).toHaveFocus();
  });

  it("shows reject reason and restore for rejected claims", () => {
    const { onRatify } = renderItem({
      id: "m2",
      content: "从不喝咖啡",
      origin: "claim",
      claim_status: "rejected",
      reject_reason: "记错了",
    });
    expect(screen.getByText("拒绝原因：记错了")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /恢复/ }));
    expect(onRatify).toHaveBeenCalledOnce();
  });

  it("names each action with the memory, while the visible label stays short", () => {
    const content = `  ${"记住这件事".repeat(12)}  `;
    renderWithRouter(
      <ul>
        <MemoryListItem
          memory={{
            id: "m-long",
            content,
            origin: "claim",
            claim_status: "proposed",
          }}
          selected={false}
          onToggleSelect={noop}
          onRatify={noop}
          onReject={noop}
          onEdit={noop}
          onDelete={noop}
          onContinueChat={noop}
          onShowProvenance={noop}
        />
      </ul>,
    );
    const sentence = content.trim();
    const confirm = screen.getByRole("button", { name: `确认：${sentence}` });
    expect(confirm).toHaveTextContent("确认");
    expect(confirm.textContent).not.toContain(sentence);
    expect(screen.getByRole("button", { name: `拒绝：${sentence}` })).toHaveTextContent("拒绝");
    expect(screen.getByRole("button", { name: `编辑：${sentence}` })).toHaveTextContent("编辑");
    expect(screen.getByRole("button", { name: `继续聊：${sentence}` })).toHaveTextContent("继续聊");
    expect(screen.getByRole("button", { name: `来源：${sentence}` })).toHaveTextContent("来源");
    expect(screen.getByRole("button", { name: `忘掉：${sentence}` })).toHaveTextContent("忘掉");
    expect(screen.getByRole("checkbox", { name: `选择：${sentence}` })).toBeInTheDocument();
    expect(document.querySelector("p")?.textContent).toBe(content);
  });

  it("keeps the short name when the memory is only whitespace", () => {
    renderWithRouter(
      <ul>
        <MemoryListItem
          memory={{
            id: "m-blank",
            content: "   ",
            origin: "self_report",
            claim_status: "ratified",
          }}
          selected={false}
          onToggleSelect={noop}
          onRatify={noop}
          onReject={noop}
          onEdit={noop}
          onDelete={noop}
          onContinueChat={noop}
          onShowProvenance={noop}
        />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "编辑" })).toHaveTextContent("编辑");
    expect(screen.getByRole("button", { name: "继续聊" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "来源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "忘掉" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /：/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择" })).toBeInTheDocument();
    expect(document.querySelector("p")?.textContent).toBe("   ");
  });
});
