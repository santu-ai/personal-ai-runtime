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
    const confirm = screen.getByRole("button", { name: "确认" });
    confirm.focus();
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(confirm).toHaveClass("opacity-50");
    expect(confirm).toHaveFocus();
    const reject = screen.getByRole("button", { name: "拒绝" });
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
    const restore = screen.getByRole("button", { name: "恢复" });
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
});
