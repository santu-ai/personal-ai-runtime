import { useEffect, useId, useRef } from "react";
import type { Components } from "react-markdown";
import Button from "../ui/Button";
import { LazyMarkdown } from "../chat/LazyMarkdown";

const DIGEST_MARKDOWN_COMPONENTS: Components = {};

interface Props {
  open: boolean;
  title: string;
  content: string;
  onClose: () => void;
}

export default function InboxDigestModal({ open, title, content, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-surface-raised border border-border-strong rounded-xl max-w-lg w-full shadow-xl flex flex-col max-h-[80vh] outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
          <div className="flex items-start justify-between gap-3">
            <h3 id={titleId} className="text-lg font-semibold text-fg-primary">
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-fg-tertiary hover:text-fg-primary text-xl leading-none shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 markdown-content text-sm leading-relaxed">
          <LazyMarkdown content={content} components={DIGEST_MARKDOWN_COMPONENTS} />
        </div>
        <div className="px-5 py-4 border-t border-border-subtle flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
