type Tone = "default" | "success" | "warning" | "danger" | "insight";

const toneClasses: Record<Tone, string> = {
  default: "bg-surface-overlay text-text-secondary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  insight: "bg-insight/15 text-insight",
};

const dotColors: Record<Tone, string> = {
  default: "bg-text-tertiary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  insight: "bg-insight",
};

interface Props {
  children?: React.ReactNode;
  tone?: Tone;
  /** Show a leading status dot — useful for compact inline state indicators. */
  dot?: boolean;
  className?: string;
}

export default function Badge({ children, tone = "default", dot = false, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${toneClasses[tone]} ${className}`}
    >
      {dot && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColors[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}
