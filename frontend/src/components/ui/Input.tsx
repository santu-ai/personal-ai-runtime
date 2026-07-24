import {
  useCallback,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Eye, EyeOff } from "lucide-react";

const DEFAULT_MASKED = "••••••••";

const baseInput =
  "bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors focus:border-focus-ring disabled:opacity-50 disabled:cursor-not-allowed";

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** True when value is a server-side masked placeholder, not the real secret. */
  isSavedSecret?: boolean;
  /** Show invalid (error) styling — red border instead of focus-ring on focus. */
  invalid?: boolean;
}

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean;
  invalid?: boolean;
}

export function Textarea({ autoGrow = false, invalid = false, className = "", onInput, ...props }: Props) {
  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      if (autoGrow) {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      }
      if (onInput) {
        onInput(e as unknown as React.InputEvent<HTMLTextAreaElement>);
      }
    },
    [autoGrow, onInput],
  );

  return (
    <textarea
      className={`${baseInput} ${invalid ? "border-danger focus:border-danger" : ""} ${className}`}
      onInput={handleInput}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Input({
  invalid = false,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`${baseInput} ${invalid ? "border-danger focus:border-danger" : ""} ${className}`}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function PasswordInput({
  className = "",
  isSavedSecret = false,
  invalid = false,
  value,
  placeholder,
  type: _type,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const masked =
    isSavedSecret || value === DEFAULT_MASKED || String(value ?? "").startsWith("••••");
  const showPlainSavedHint = masked && visible;
  const inputType = visible ? "text" : "password";
  const inputValue = showPlainSavedHint ? "" : value;
  const inputPlaceholder = showPlainSavedHint
    ? "密钥已保存，不可查看原文；输入新值以替换"
    : placeholder;

  return (
    <div className="relative">
      <input
        key={visible ? "visible" : "hidden"}
        type={inputType}
        value={inputValue}
        placeholder={inputPlaceholder}
        className={`w-full ${baseInput} pl-3 pr-10 ${
          invalid ? "border-danger focus:border-danger" : ""
        } ${className}`}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-overlay/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        title={masked && !visible ? "已保存的密钥无法查看原文" : visible ? "隐藏" : "显示明文"}
      >
        {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  );
}
