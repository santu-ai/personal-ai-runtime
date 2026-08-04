import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import Card from "./Card";

interface Props {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  /** When true, skip the Card shell — use when children already render a Card. */
  bare?: boolean;
  children: ReactNode;
}

export default function Disclosure({
  title,
  description,
  defaultOpen = false,
  bare = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = useId();

  const header = (
    <button
      type="button"
      id={buttonId}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((v) => !v)}
      className="w-full flex items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-lg"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-fg-secondary">{title}</h3>
        {description && !open && (
          <p className="text-xs text-fg-tertiary mt-1 line-clamp-1">{description}</p>
        )}
      </div>
      <ChevronDown
        size={16}
        className={`shrink-0 mt-0.5 text-fg-tertiary transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
  );

  const panel = (
    <div
      id={panelId}
      role="region"
      aria-labelledby={buttonId}
      hidden={!open}
      className={open ? "mt-3" : undefined}
    >
      {open ? children : null}
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-0">
        <div className="px-1 py-1">{header}</div>
        {panel}
      </div>
    );
  }

  return (
    <Card>
      {header}
      {panel}
    </Card>
  );
}
