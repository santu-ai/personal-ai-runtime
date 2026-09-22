import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Use h1 for top-level routes; h2 for nested panels. */
  as?: "h1" | "h2";
}

/** Consistent page chrome title row used across primary routes. */
export default function PageHeader({
  title,
  description,
  actions,
  className = "",
  as: Tag = "h2",
}: Props) {
  return (
    <div className={`page-header ${className}`.trim()}>
      <div className="min-w-0">
        <Tag className="page-title">{title}</Tag>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
