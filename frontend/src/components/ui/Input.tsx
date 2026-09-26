import {
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Eye, EyeOff } from "lucide-react";

const DEFAULT_MASKED = "••••••••";

export const inputBaseClass =
  "bg-surface-overlay border border-border-subtle rounded-md px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary transition-colors focus:border-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 disabled:cursor-not-allowed";

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** True when value is a server-side masked placeholder, not the real secret. */
  isSavedSecret?: boolean;
  /** Show invalid (error) styling — red border instead of focus-ring on focus. */
  invalid?: boolean;
}

export function Input({
  invalid = false,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`${inputBaseClass} ${invalid ? "border-danger focus:border-danger focus-visible:ring-danger" : ""} ${className}`}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function TextArea({
  invalid = false,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`${inputBaseClass} min-h-20 resize-y ${invalid ? "border-danger focus:border-danger focus-visible:ring-danger" : ""} ${className}`}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

/** 测试在绘制阶段读焦点。显示或隐藏换掉输入框时，这里能看到光标是否已经回去。 */
export const passwordInputLayoutFocus = {
  notify: null as (() => void) | null,
};

function caretOffset(input: HTMLInputElement): number {
  try {
    if (typeof input.selectionStart === "number") return input.selectionStart;
  } catch {
    // type=password 时部分浏览器读不到选区。
  }
  return input.value.length;
}

function placeCaret(input: HTMLInputElement, offset: number) {
  const clamped = Math.min(Math.max(offset, 0), input.value.length);
  try {
    input.setSelectionRange(clamped, clamped);
  } catch {
    // type=password 时部分浏览器不允许设置选区。焦点仍留在这一栏。
  }
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
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreCaret = useRef<number | null>(null);
  const masked =
    isSavedSecret || value === DEFAULT_MASKED || String(value ?? "").startsWith("••••");
  const showPlainSavedHint = masked && visible;
  const inputType = visible ? "text" : "password";
  const inputValue = showPlainSavedHint ? "" : value;
  const inputPlaceholder = showPlainSavedHint
    ? "密钥已保存，不可查看原文；输入新值以替换"
    : placeholder;

  // 显示和隐藏会换掉输入框。焦点还在这一栏时，卸下的同一轮把光标放回去。
  // 放到绘制前，不先停在页面空白。焦点在眼睛按钮或别的控件上就不再抢。
  useLayoutEffect(() => {
    const pos = restoreCaret.current;
    if (pos !== null) {
      restoreCaret.current = null;
      const input = inputRef.current;
      if (input) {
        input.focus();
        placeCaret(input, pos);
      }
    }
    passwordInputLayoutFocus.notify?.();
  }, [visible]);

  const toggleVisible = () => {
    const input = inputRef.current;
    if (input && document.activeElement === input) restoreCaret.current = caretOffset(input);
    setVisible((current) => !current);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        key={visible ? "visible" : "hidden"}
        type={inputType}
        value={inputValue}
        placeholder={inputPlaceholder}
        className={`w-full ${inputBaseClass} pl-3 pr-10 ${
          invalid ? "border-danger focus:border-danger focus-visible:ring-danger" : ""
        } ${className}`}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleVisible}
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-md text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        aria-label={visible ? "隐藏密码" : "显示密码"}
        title={masked && !visible ? "已保存的密钥无法查看原文" : visible ? "隐藏" : "显示明文"}
      >
        {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
      </button>
    </div>
  );
}
