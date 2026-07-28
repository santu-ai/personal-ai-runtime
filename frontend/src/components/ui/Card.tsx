import type { HTMLAttributes } from "react";

type Variant = "default" | "interactive" | "sunken";

const variantClasses: Record<Variant, string> = {
  // Default: standard raised card on the base background.
  default: "bg-surface-raised border-border-subtle",
  // Interactive: list items, clickable rows — hover lifts the border.
  interactive:
    "bg-surface-raised border-border-subtle hover:border-border-strong cursor-pointer transition-colors",
  // Sunken: wells, code blocks, inline previews — recessed into the surface.
  sunken: "bg-surface-sunken border-border-subtle",
};

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: "sm" | "md";
  variant?: Variant;
}

export default function Card({
  padding = "md",
  variant = "default",
  className = "",
  children,
  ...props
}: Props) {
  const pad = padding === "sm" ? "p-3" : "p-4";
  return (
    <div className={`border rounded-xl ${variantClasses[variant]} ${pad} ${className}`} {...props}>
      {children}
    </div>
  );
}
