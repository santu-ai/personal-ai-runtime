import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import VoiceInput from "./VoiceInput";

function installRecognition() {
  const start = vi.fn();
  const abort = vi.fn();
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start = start;
    stop = vi.fn();
    abort = abort;
  }
  window.SpeechRecognition = FakeRecognition as unknown as typeof window.SpeechRecognition;
  return { start, abort };
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

  it("keeps the name when the button is disabled", () => {
    render(<VoiceInput onTranscript={vi.fn()} disabled />);
    const button = screen.getByRole("button", { name: "语音输入" });
    expect(button).toBeDisabled();
    expect(button.querySelector("[data-voice-name]")).toHaveTextContent("语音输入");
  });
});
