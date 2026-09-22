import type { HTMLAttributes } from "react";

type Variant = "default" | "interactive" | "sunken" | "ghost";

const variantClasses: Record<Variant, string> = {
  // Default: raised card on the app canvas.
  default: "bg-surface-raised border-border-subtle shadow-sm",
  // Interactive: list items, clickable rows — hover lifts the border.
  interactive:
    "bg-surface-raised border-border-subtle shadow-sm hover:border-border-strong hover:bg-surface-hover/40 cursor-pointer transition-colors",
  // Sunken: wells, code blocks, inline previews — recessed into the surface.
  sunken: "bg-surface-sunken border-border-subtle",
  // Ghost: bordered outline without fill — for nested panels.
  ghost: "bg-transparent border-border-subtle",
};

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
  variant?: Variant;
}

export default function Card({
  padding = "md",
  variant = "default",
  className = "",
  children,
  ...props
}: Props) {
  const pad = padding === "none" ? "" : padding === "sm" ? "p-3" : padding === "lg" ? "p-5" : "p-4";
  return (
    <div className={`border rounded-lg ${variantClasses[variant]} ${pad} ${className}`} {...props}>
      {children}
    </div>
  );
}
