interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className = "" }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-14 text-center ${className}`.trim()}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-overlay text-fg-tertiary">
          {icon}
        </div>
      )}
      <h3 className="text-base font-medium tracking-tight text-fg-primary">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-fg-tertiary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
