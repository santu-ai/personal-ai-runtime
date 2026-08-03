import { useEffect, useCallback } from "react";
import VoiceInput from "./VoiceInput";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder = "输入消息... (Enter 发送, Shift+Enter 换行)",
  inputRef,
}: ChatComposerProps) {
  const adjustTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputRef]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [value, adjustTextareaHeight]);

  const handleVoiceTranscript = useCallback(
    (transcript: string) => {
      onChange(value ? `${value} ${transcript}` : transcript);
      inputRef.current?.focus();
    },
    [value, onChange, inputRef],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex gap-3 items-end bg-surface-raised rounded-xl border border-border-strong focus-within:border-focus-ring transition-colors p-3">
      <VoiceInput onTranscript={handleVoiceTranscript} disabled={disabled} />
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={adjustTextareaHeight}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="flex-1 bg-transparent border-none outline-none resize-none text-fg-primary placeholder:text-fg-tertiary min-h-[24px] max-h-[200px] py-1"
      />
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
          disabled
            ? "bg-surface-overlay/50 text-fg-secondary cursor-not-allowed"
            : "bg-surface-overlay hover:bg-border-strong disabled:bg-surface-overlay disabled:text-fg-disabled text-white"
        }`}
      >
        {disabled ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            思考中
          </span>
        ) : (
          "发送"
        )}
      </button>
    </div>
  );
}
