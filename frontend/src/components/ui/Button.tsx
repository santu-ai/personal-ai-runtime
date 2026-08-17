import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "subtle" | "ghost" | "danger";

const variantClasses: Record<Variant, string> = {
  // Primary: insight accent. Success green stays for completed / safe states.
  primary:
    "bg-insight hover:bg-insight/90 text-white disabled:bg-surface-overlay disabled:text-fg-disabled",
  secondary:
    "bg-surface-raised hover:bg-surface-overlay text-fg-primary border border-border-subtle disabled:opacity-50",
  // Subtle: ghost, but with a faint background — for tertiary inline actions.
  subtle: "bg-transparent hover:bg-surface-overlay text-fg-secondary disabled:opacity-50",
  ghost: "bg-transparent hover:bg-surface-overlay text-fg-secondary disabled:opacity-50",
  // Danger: irreversible delete/failure only. NOT for "reject" (rejecting is safe).
  danger:
    "bg-danger hover:bg-danger/90 text-white disabled:bg-surface-overlay disabled:text-fg-disabled",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...props
}: Props) {
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs gap-1.5" : "px-4 py-2 text-sm gap-2";
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors ${sizeClass} ${variantClasses[variant]} ${focusRing} disabled:cursor-not-allowed ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-3.5 w-3.5 opacity-75"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373,0,0,5.373,0,12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
