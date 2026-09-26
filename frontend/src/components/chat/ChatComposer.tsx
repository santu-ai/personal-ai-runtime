import { useEffect, useCallback } from "react";
import { Send, Square } from "lucide-react";
import VoiceInput from "./VoiceInput";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import { isImeKeyboardEvent } from "../../utils/imeKey";

const SENDING_STATUS = "正在发送…，输入消息仍可改";
const GENERATING_STATUS = "正在生成，输入消息可以先写下一条";
const CONFIRM_STATUS = "先在上面确认或取消，暂不能输入消息";

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
  // 这一栏仍是输入消息。占位先写出当前能不能发，再留着这几个字。
  // 读屏名字固定，不跟着占位变成状态句；写了字、占位看不见时也还是这个名字。
  const statusPlaceholder = generating
    ? GENERATING_STATUS
    : pending
      ? SENDING_STATUS
      : fieldDisabled
        ? CONFIRM_STATUS
        : placeholder;
  // 这两句写在占位里。焦点还在输入框时，读屏名字仍是「输入消息」，听不到。
  // 待确认那句不另读：焦点在确认或回答上。平时的占位不另读。
  const spokenStatus = generating ? GENERATING_STATUS : pending ? SENDING_STATUS : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 组字或输入法处理键时的 Enter 交给输入法，不把还没上屏的字发出去。
    if (e.key === "Enter" && !e.shiftKey && !isImeKeyboardEvent(e.nativeEvent)) {
      e.preventDefault();
      if (!generating && !disabled && !pending) onSend();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-xl border border-border-subtle bg-surface-raised p-2.5 shadow-sm transition-colors focus-within:border-focus-ring">
      <VoiceInput onTranscript={handleVoiceTranscript} disabled={fieldDisabled} />
      {spokenStatus ? (
        <span className="sr-only" role="status">
          {/* 出现时读出来，等当前这一句说完。不把焦点抢过来。 */}
          {spokenStatus}
        </span>
      ) : null}
      <textarea
        ref={inputRef}
        data-chat-composer=""
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={adjustTextareaHeight}
        onKeyDown={handleKeyDown}
        aria-label="输入消息"
        placeholder={statusPlaceholder}
        rows={1}
        disabled={fieldDisabled}
        aria-busy={holding || undefined}
        className="min-h-[28px] max-h-[200px] flex-1 resize-none rounded-sm border-none bg-transparent py-1.5 text-sm text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
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
        title={fieldDisabled ? "先在上面确认或取消，才能继续发送" : undefined}
        className={`shrink-0${holding ? " opacity-50" : ""}`}
      >
        {generating ? (
          <>
            <Square size={12} fill="currentColor" />
            取消生成
          </>
        ) : pending ? (
          <>
            <Spinner size="sm" />
            发送中
          </>
        ) : fieldDisabled ? (
          "待你确认"
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
