import type { ReactNode } from "react";

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

/** Compact tab / mode switcher (list · review · graph). */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex gap-0.5 rounded-md bg-surface-overlay p-0.5 ${className}`.trim()}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
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
