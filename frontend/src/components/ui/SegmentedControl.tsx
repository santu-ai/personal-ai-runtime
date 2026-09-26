import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isImeKeyboardEvent } from "../../utils/imeKey";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

/** 沿着给出的顺序移动。到头就停住，不绕回另一头。 */
function nextSegmentIndex(index: number, count: number, key: string): number | null {
  if (index < 0 || count === 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(count - 1, index + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Compact tab / mode switcher (list · review · graph). */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // 组字或输入法处理键时不切换，也不拦住这一下。
    if (isImeKeyboardEvent(event.nativeEvent)) return;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const focused = buttons
      ? [...buttons].findIndex(
          (button) => button === event.target || button.contains(event.target as Node),
        )
      : -1;
    const from = focused >= 0 ? focused : tabStop;
    const next = nextSegmentIndex(from, options.length, event.key);
    if (next == null) return;
    event.preventDefault();
    const target = options[next];
    if (!target || next === from) return;
    onChange(target.value);
    buttons?.[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`inline-flex gap-0.5 rounded-md bg-surface-overlay p-0.5 ${className}`.trim()}
    >
      {options.map((opt, index) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              active
                ? "bg-surface-raised text-fg-primary shadow-sm"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {opt.icon}
            {opt.label}
            {opt.badge}
          </button>
        );
      })}
    </div>
  );
}
