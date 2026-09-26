import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import MemoryGraphView from "./MemoryGraphView";
import type { MemoryGraph } from "../../api/client";

const graph: MemoryGraph = {
  nodes: [
    { id: "a", content: "喜欢早起", category: "preference", confidence: 0.9 },
    { id: "b", content: "住在上海", category: "fact", confidence: 0.8 },
    { id: "c", content: "每周跑步", category: "habit", confidence: 0.7 },
  ],
  edges: [{ source: "a", target: "b", weight: 1 }],
};

function node(content: string): HTMLElement {
  return screen.getByRole("button", {
    name: (accessibleName) => accessibleName === content || accessibleName.endsWith(`，${content}`),
  });
}

function circleOf(name: string): Element {
  const dot = node(name).querySelector("circle");
  if (!dot) throw new Error(`missing circle: ${name}`);
  return dot;
}

describe("MemoryGraphView", () => {
  it("keeps memory text hidden until hover or keyboard focus", () => {
    render(<MemoryGraphView graph={graph} />);
    const first = node("喜欢早起");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(node("住在上海")).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByText("喜欢早起")).not.toBeInTheDocument();

    fireEvent.mouseEnter(first);
    expect(screen.getByText("喜欢早起")).toBeInTheDocument();
    expect(circleOf("喜欢早起")).toHaveAttribute("stroke", "#f3f4f6");

    fireEvent.mouseLeave(first);
    expect(screen.queryByText("喜欢早起")).not.toBeInTheDocument();

    act(() => {
      first.focus();
    });
    expect(first).toHaveFocus();
    expect(screen.getByText("喜欢早起")).toBeInTheDocument();
    expect(circleOf("喜欢早起")).toHaveAttribute("stroke", "var(--color-focus-ring)");
    expect(first).toHaveClass("focus-visible:outline-none");
  });

  it("moves along the graph with arrow keys and stops at the ends", () => {
    render(<MemoryGraphView graph={graph} />);
    const first = node("喜欢早起");
    const second = node("住在上海");
    const third = node("每周跑步");
    first.focus();

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("住在上海")).toBeInTheDocument();
    expect(screen.queryByText("喜欢早起")).not.toBeInTheDocument();

    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: "ArrowDown" });
    expect(third).toHaveFocus();

    fireEvent.keyDown(third, { key: "ArrowUp" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: "ArrowLeft" });
    expect(second).toHaveFocus();
  });

  it("keeps a long label short on hover and writes the whole sentence for keyboard focus", () => {
    const full =
      "这是一条很长的记忆，悬停只写出前三十个字，键盘落到这个点时要写出整句，不能停在省略号后面。";
    const preview = `${full.slice(0, 30)}...`;
    render(
      <MemoryGraphView
        graph={{
          nodes: [
            { id: "long", content: full, category: "preference", confidence: 0.9 },
            { id: "short", content: "短记忆", category: "fact", confidence: 0.8 },
          ],
          edges: [],
        }}
      />,
    );
    const long = node(full);
    expect(long.querySelector("[data-memory-full]")).toBeNull();
    expect(long.querySelector("text")).toBeNull();

    fireEvent.mouseEnter(long);
    const short = long.querySelector("text");
    expect(short).toHaveTextContent(preview);
    expect(short).toHaveClass("group-focus-visible:hidden");
    expect(short?.getAttribute("class")).not.toContain("group-hover:");
    const caption = long.querySelector("[data-memory-full]");
    expect(caption).toHaveTextContent(full);
    expect(caption).toHaveClass("hidden", "group-focus-visible:block");
    expect(caption?.getAttribute("class")).not.toContain("group-hover:");
    expect(caption).not.toHaveAttribute("tabindex");
    const svg = long.closest("svg");
    const canvasWidth = Number(svg?.getAttribute("width"));
    const canvasHeight = Number(svg?.getAttribute("height"));
    const x = Number(caption?.getAttribute("x"));
    const y = Number(caption?.getAttribute("y"));
    const boxWidth = Number(caption?.getAttribute("width"));
    const boxHeight = Number(caption?.getAttribute("height"));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + boxWidth).toBeLessThanOrEqual(canvasWidth);
    expect(y + boxHeight).toBeLessThanOrEqual(canvasHeight);

    fireEvent.mouseLeave(long);
    expect(long.querySelector("[data-memory-full]")).toBeNull();

    const brief = node("短记忆");
    fireEvent.mouseEnter(brief);
    expect(brief.querySelector("[data-memory-full]")).toBeNull();
    expect(brief.querySelector("text")).toHaveTextContent("短记忆");
    expect(brief.querySelector("text")?.getAttribute("class")).not.toContain(
      "group-focus-visible:hidden",
    );
  });

  it("writes the same category names as the list and keeps the dot decorative", () => {
    render(<MemoryGraphView graph={graph} />);
    const legend = screen.getByRole("list", { name: "类别" });
    const names = [...legend.querySelectorAll("[data-memory-legend-name]")].map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["你的偏好", "你的习惯", "关于你"]);
    expect(within(legend).queryByText("preference")).not.toBeInTheDocument();
    expect(within(legend).queryByText("fact")).not.toBeInTheDocument();
    expect(within(legend).queryByText("habit")).not.toBeInTheDocument();
    expect(within(legend).queryByText("你的目标")).not.toBeInTheDocument();
    expect(within(legend).queryByText("你经历过的事")).not.toBeInTheDocument();

    const habitDot = within(legend).getByText("你的习惯").previousElementSibling;
    expect(habitDot).toHaveAttribute("aria-hidden", "true");
    expect(habitDot).toHaveStyle({ backgroundColor: "#6b7280" });
    const factDot = within(legend).getByText("关于你").previousElementSibling;
    expect(factDot).toHaveStyle({ backgroundColor: "#10b981" });

    const preference = node("喜欢早起");
    expect(preference).toHaveAccessibleName("你的偏好，喜欢早起");
    expect(preference.querySelector("text")).toBeNull();

    fireEvent.mouseEnter(preference);
    const lines = [...preference.querySelectorAll("text")].map((item) => item.textContent);
    expect(lines).toEqual(["喜欢早起", "你的偏好"]);
    expect(preference.querySelector("[data-memory-full]")).toBeNull();
  });

  it("keeps an unknown category as the original word and skips a blank one", () => {
    render(
      <MemoryGraphView
        graph={{
          nodes: [
            { id: "known", content: "喜欢早起", category: "preference", confidence: 0.9 },
            { id: "raw", content: "一条没翻译的分类", category: "custom_kind", confidence: 0.5 },
            { id: "blank", content: "没有分类", category: "  ", confidence: 0.4 },
            { id: "goal", content: "跑完马拉松", category: "goal", confidence: 0.6 },
          ],
          edges: [],
        }}
      />,
    );
    const legend = screen.getByRole("list", { name: "类别" });
    const names = [...legend.querySelectorAll("[data-memory-legend-name]")].map(
      (item) => item.textContent,
    );
    expect(names).toEqual(["你的偏好", "你的目标", "custom_kind"]);
    expect(node("一条没翻译的分类")).toHaveAccessibleName("custom_kind，一条没翻译的分类");
    expect(node("没有分类")).toHaveAccessibleName("没有分类");
    expect(node("跑完马拉松")).toHaveAccessibleName("你的目标，跑完马拉松");
    const preferenceDot = within(legend).getByText("你的偏好").previousElementSibling;
    const goalDot = within(legend).getByText("你的目标").previousElementSibling;
    expect(preferenceDot?.getAttribute("style")).toBe(goalDot?.getAttribute("style"));
  });

  it("writes the category above a long sentence when the keyboard lands", () => {
    const full =
      "这是一条很长的记忆，悬停只写出前三十个字，键盘落到这个点时要写出整句，不能停在省略号后面。";
    render(
      <MemoryGraphView
        graph={{
          nodes: [{ id: "long", content: full, category: "event", confidence: 0.9 }],
          edges: [],
        }}
      />,
    );
    const long = node(full);
    expect(long).toHaveAccessibleName(`你经历过的事，${full}`);
    act(() => {
      long.focus();
    });
    const caption = long.querySelector("[data-memory-full]");
    expect(caption).toHaveTextContent("你经历过的事");
    expect(caption).toHaveTextContent(full);
    expect(caption).toHaveClass("hidden", "group-focus-visible:block");
    const categoryLine = [...long.querySelectorAll("text")].find(
      (item) => item.textContent === "你经历过的事",
    );
    expect(categoryLine).toHaveClass("group-focus-visible:hidden");
  });

  it("does not move while an IME process key is down", () => {
    render(<MemoryGraphView graph={graph} />);
    const first = node("喜欢早起");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(first, { key: "ArrowDown", keyCode: 229 });
    fireEvent.keyDown(first, { key: " ", keyCode: 229 });
    expect(first).toHaveFocus();
    expect(node("住在上海")).toHaveAttribute("tabindex", "-1");
  });
});
