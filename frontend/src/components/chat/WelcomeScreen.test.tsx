import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WelcomeScreen from "./WelcomeScreen";
import type { MemoryRow } from "../../api/types";

function renderWelcome({
  recentMemories = [],
  suggestions = [],
}: {
  recentMemories?: MemoryRow[];
  suggestions?: string[];
} = {}) {
  render(
    <WelcomeScreen
      recentMemories={recentMemories}
      suggestions={suggestions}
      onPickPrompt={vi.fn()}
    />,
  );
}

describe("WelcomeScreen prompt chips", () => {
  it("writes the sentence a capability chip will insert when the keyboard lands on it", () => {
    renderWelcome();
    const chip = screen.getByRole("button", {
      name: "帮我在桌面创建一个 todo.md，列出今天的任务",
    });
    expect(chip).toHaveTextContent("读写文件");
    expect(chip).toHaveAttribute("title", "帮我在桌面创建一个 todo.md，列出今天的任务");
    const name = chip.querySelector("[data-prompt-name]");
    expect(name).toHaveTextContent("帮我在桌面创建一个 todo.md，列出今天的任务");
    expect(name).toHaveClass("hidden", "group-focus-visible:block");
    expect(chip.querySelector("span")).toHaveClass("group-focus-visible:hidden");
    expect(chip.querySelector("svg")).toBeInTheDocument();
  });

  it("leaves a short remembered line as the whole sentence", () => {
    renderWelcome({
      recentMemories: [{ id: "m1", content: "喜欢早起跑步" }],
    });
    const chip = screen.getByRole("button", { name: "· 喜欢早起跑步" });
    expect(chip.querySelector("[data-prompt-name]")).toBeNull();
    expect(chip).toHaveAttribute("title", "喜欢早起跑步");
    expect(chip).not.toHaveAttribute("aria-label");
  });

  it("writes the whole memory when a remembered line is longer than the preview", () => {
    const content = "记".repeat(61);
    renderWelcome({
      recentMemories: [{ id: "m2", content }],
    });
    const chip = screen.getByRole("button", { name: `· ${content}` });
    expect(chip).toHaveTextContent(`· ${"记".repeat(60)}…`);
    expect(chip.querySelector("[data-prompt-name]")).toHaveTextContent(`· ${content}`);
    expect(chip.querySelector("[data-prompt-name]")).toHaveClass(
      "hidden",
      "group-focus-visible:block",
    );
    expect(chip.querySelector("span")).toHaveClass("group-focus-visible:hidden");
    expect(chip).toHaveAttribute("title", content);
  });

  it("writes the whole suggestion when it is longer than the preview and leaves a short one", () => {
    const long = "建".repeat(51);
    renderWelcome({ suggestions: ["查看今日收件箱摘要", long] });
    const chip = screen.getByRole("button", { name: long });
    expect(chip).toHaveTextContent(`${"建".repeat(50)}…`);
    expect(chip.querySelector("[data-prompt-name]")).toHaveTextContent(long);
    expect(chip.querySelector("[data-prompt-name]")).toHaveClass(
      "hidden",
      "group-focus-visible:block",
    );
    expect(chip).toHaveAttribute("title", long);
    const short = screen.getByRole("button", { name: "查看今日收件箱摘要" });
    expect(short.querySelector("[data-prompt-name]")).toBeNull();
    expect(short).not.toHaveAttribute("title");
  });
});
