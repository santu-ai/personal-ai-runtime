export type StatusTone = "danger" | "warning" | "insight" | "success" | "neutral";

/** Shared surface tokens for banners, toasts, and inline status strips. */
export const STATUS_TONE: Record<
  StatusTone,
  { surface: string; title: string; body: string; icon: string }
> = {
  danger: {
    surface: "border-danger/40 bg-danger/5",
    title: "text-danger",
    body: "text-fg-secondary",
    icon: "text-danger",
  },
  warning: {
    surface: "border-warning/40 bg-warning/10",
    title: "text-warning",
    body: "text-fg-secondary",
    icon: "text-warning",
  },
  insight: {
    surface: "border-insight/30 bg-insight/10",
    title: "text-insight",
    body: "text-fg-secondary",
    icon: "text-insight",
  },
  success: {
    surface: "border-success/30 bg-success/10",
    title: "text-success",
    body: "text-fg-secondary",
    icon: "text-success",
  },
  neutral: {
    surface: "border-border-subtle bg-surface-raised",
    title: "text-fg-primary",
    body: "text-fg-secondary",
    icon: "text-fg-tertiary",
  },
};
