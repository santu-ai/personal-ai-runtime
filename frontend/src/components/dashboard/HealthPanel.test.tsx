import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HealthPanel from "./HealthPanel";

function renderPanel() {
  return render(
    <HealthPanel
      cost={{
        total_prompt_tokens: 100,
        total_completion_tokens: 20,
        total_cost: 0.01,
        total_calls: 4,
        failed_calls: 0,
        avg_latency_ms: 12,
      }}
      tools={[{ tool_name: "web_search", total_calls: 2, failed_calls: 0, avg_latency_ms: 8 }]}
      memory={{ total_memories: 3, recent_7d: 1, categories: { habit: 2 } }}
      health={{ active_work_items: 1, tool_failure_rate_24h: 0 }}
      dashboard={{
        data_sovereignty: {
          total_events: 10,
          total_memories: 3,
          total_goals: 1,
          total_conversations: 2,
          memories_self_report: 1,
          memories_claim: 2,
          goals_active: 1,
          goals_completed: 0,
        },
      }}
    />,
  );
}

describe("HealthPanel", () => {
  it("stays collapsed until opened, then Escape collapses it and leaves focus on 运行状况", () => {
    renderPanel();
    const button = screen.getByRole("button", { name: /运行状况/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: /运行状况/ })).not.toBeInTheDocument();
    expect(screen.queryByText("LLM 成功率")).not.toBeInTheDocument();
    expect(fireEvent.keyDown(button, { key: "Escape" })).toBe(true);
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: /运行状况/ });
    expect(region).toHaveAttribute("id", button.getAttribute("aria-controls"));
    expect(screen.getByText("LLM 成功率")).toBeInTheDocument();
    expect(screen.getByText("我的数据")).toBeInTheDocument();

    button.focus();
    expect(fireEvent.keyDown(button, { key: "Escape", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Escape", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(button, { key: "Process" })).toBe(true);
    expect(button).toHaveAttribute("aria-expanded", "true");

    const inside = screen.getByText("LLM 成功率");
    expect(fireEvent.keyDown(inside, { key: "Escape" })).toBe(false);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
    expect(screen.queryByText("LLM 成功率")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /运行状况/ })).not.toBeInTheDocument();
  });
});
