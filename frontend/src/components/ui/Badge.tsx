type Tone = "default" | "success" | "warning" | "danger" | "insight";

const toneClasses: Record<Tone, string> = {
  default: "bg-surface-overlay text-fg-secondary border border-border-subtle/60",
  success: "bg-success/12 text-success border border-success/20",
  warning: "bg-warning/12 text-warning border border-warning/20",
  danger: "bg-danger/12 text-danger border border-danger/20",
  insight: "bg-insight/12 text-insight border border-insight/20",
};

const dotColors: Record<Tone, string> = {
  default: "bg-fg-tertiary",
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
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${toneClasses[tone]} ${className}`}
    >
      {dot && (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${dotColors[tone]}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
