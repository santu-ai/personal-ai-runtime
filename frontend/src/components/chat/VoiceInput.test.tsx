import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import VoiceInput from "./VoiceInput";

interface InterimEvent {
  results: Array<{ 0: { transcript: string }; isFinal: boolean }>;
}

function installRecognition() {
  const start = vi.fn();
  const abort = vi.fn();
  const sessions: Array<{ onresult: ((event: InterimEvent) => void) | null }> = [];
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onresult: ((event: InterimEvent) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() {
      sessions.push(this);
    }
    start = start;
    stop = vi.fn();
    abort = abort;
  }
  window.SpeechRecognition = FakeRecognition as unknown as typeof window.SpeechRecognition;
  return {
    start,
    abort,
    emitInterim(text: string) {
      sessions[0]?.onresult?.({
        results: [{ 0: { transcript: text }, isFinal: false }],
      });
    },
  };
}

describe("VoiceInput", () => {
  afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  it("writes 语音输入 when the keyboard lands, while the icon stays for the pointer", () => {
    render(<VoiceInput onTranscript={vi.fn()} />);
    const button = screen.getByRole("button", { name: "语音输入" });
    expect(button).toHaveAttribute("title", "语音输入");
    const name = button.querySelector("[data-voice-name]");
    expect(name).toHaveTextContent("语音输入");
    expect(name).toHaveClass("hidden", "group-focus-visible:block");
    expect(button.querySelector("svg")).toHaveClass("group-focus-visible:hidden");
    expect(button).toHaveClass(
      "focus-visible:outline-none",
      "focus-visible:ring-2",
      "focus-visible:ring-focus-ring",
    );
  });

  it("writes 停止录音 once listening starts", () => {
    const { start } = installRecognition();
    render(<VoiceInput onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    expect(start).toHaveBeenCalledTimes(1);
    const stop = screen.getByRole("button", { name: "停止录音" });
    expect(stop).toHaveAttribute("title", "停止录音");
    expect(stop.querySelector("[data-voice-name]")).toHaveTextContent("停止录音");
    expect(stop.querySelector("svg")).toHaveClass("group-focus-visible:hidden");
  });

  it("writes the whole interim line when the keyboard lands on the mic", () => {
    const line = "今天想把一篇很长的听写句子完整看完而不是停在前几个字";
    const recognition = installRecognition();
    render(<VoiceInput onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    act(() => recognition.emitInterim(line));

    const caption = screen.getByText(line);
    expect(caption).toHaveAttribute("title", line);
    expect(caption).toHaveClass(
      "max-w-40",
      "truncate",
      "group-has-[:focus-visible]/voice:max-w-none",
      "group-has-[:focus-visible]/voice:overflow-visible",
      "group-has-[:focus-visible]/voice:whitespace-normal",
      "group-has-[:focus-visible]/voice:text-clip",
      "group-has-[:focus-visible]/voice:break-words",
    );
    expect(caption.className).not.toContain("group-hover:");
    expect(caption).not.toHaveAttribute("tabindex");

    const stop = screen.getByRole("button", { name: "停止录音" });
    expect(fireEvent.keyDown(stop, { key: " " })).toBe(true);
    expect(fireEvent.keyDown(stop, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(stop, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(stop, { key: "Enter", keyCode: 229 })).toBe(true);
    expect(fireEvent.keyDown(stop, { key: "Process" })).toBe(true);
  });

  it("keeps the name when the button is disabled", () => {
    render(<VoiceInput onTranscript={vi.fn()} disabled />);
    const button = screen.getByRole("button", { name: "语音输入" });
    expect(button).toBeDisabled();
    expect(button.querySelector("[data-voice-name]")).toHaveTextContent("语音输入");
  });
});
