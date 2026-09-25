import { useEffect, useCallback } from "react";
import { Send, Square } from "lucide-react";
import VoiceInput from "./VoiceInput";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  /** 这次发送还没回来。输入框不禁用，避免焦点卸到页面空白处。 */
  pending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export default function ChatComposer({
  value,
  onChange,
  onSend,
  onCancel,
  pending = false,
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

  // 生成中、或这次发送还没回来时，不禁用输入框，否则焦点会卸到页面空白处。待确认仍禁用。
  const generating = Boolean(onCancel);
  const holding = generating || pending;
  const fieldDisabled = Boolean(disabled) && !holding;
  const actionDisabled = holding ? false : Boolean(disabled) || !value.trim();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!generating && !disabled && !pending) onSend();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border-subtle bg-surface-raised p-2.5 shadow-sm transition-colors focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring/30">
      <VoiceInput onTranscript={handleVoiceTranscript} disabled={fieldDisabled} />
      <textarea
        ref={inputRef}
        data-chat-composer=""
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={adjustTextareaHeight}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        disabled={fieldDisabled}
        aria-busy={holding || undefined}
        className="min-h-[28px] max-h-[200px] flex-1 resize-none border-none bg-transparent py-1.5 text-sm text-fg-primary outline-none placeholder:text-fg-tertiary"
      />
      <Button
        type="button"
        size="sm"
        variant={generating ? "danger" : "primary"}
        onClick={() => {
          if (generating) {
            onCancel?.();
            return;
          }
          if (pending) return;
          onSend();
        }}
        disabled={actionDisabled}
        data-chat-send=""
        aria-busy={holding || undefined}
        className={`shrink-0${holding ? " opacity-50" : ""}`}
      >
        {generating ? (
          <>
            <Square size={12} fill="currentColor" />
            取消生成
          </>
        ) : disabled ? (
          <>
            <Spinner size="sm" />
            思考中
          </>
        ) : (
          <>
            <Send size={14} />
            发送
          </>
        )}
      </Button>
    </div>
  );
}
