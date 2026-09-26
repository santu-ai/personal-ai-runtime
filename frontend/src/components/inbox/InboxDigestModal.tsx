import { isValidElement, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Components } from "react-markdown";
import Button from "../ui/Button";
import { MarkdownLink } from "../chat/MessageItem";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";
import { LazyMarkdown } from "../chat/LazyMarkdown";
import { isImeKeyboardEvent } from "../../utils/imeKey";

/** 某一行超过这么多个字，摘要里的成段代码会横向滚动，后面藏起来。 */
const DIGEST_CODE_LINE_CHARS = 80;

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function digestCodeNeedsReveal(text: string): boolean {
  return text.split("\n").some((line) => line.length > DIGEST_CODE_LINE_CHARS);
}

/** 空格和回车不把页面滚走。组字或输入法处理键时这一下不拦住。 */
function keepDigestCodeKeysFromScrolling(event: KeyboardEvent<HTMLElement>) {
  if (isImeKeyboardEvent(event.nativeEvent)) return;
  if (event.key === "Enter" || event.key === " ") event.preventDefault();
}

function DigestPre({ children }: { children?: ReactNode }) {
  const text = nodeText(children);
  if (!digestCodeNeedsReveal(text)) {
    return <pre>{children}</pre>;
  }
  return (
    <pre
      tabIndex={0}
      data-digest-code=""
      title={text}
      onKeyDown={keepDigestCodeKeysFromScrolling}
      // 平时横向滚动。键盘落到时写出整段并换行。鼠标悬停仍要横向滚动，整段在 title 里。
      className="focus-visible:overflow-visible focus-visible:whitespace-pre-wrap focus-visible:break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {children}
    </pre>
  );
}

const DIGEST_MARKDOWN_COMPONENTS: Components = {
  a({ href, children }) {
    return <MarkdownLink href={href}>{children}</MarkdownLink>;
  },
  pre: DigestPre,
};

interface Props {
  open: boolean;
  title: string;
  content: string;
  onClose: () => void;
}

export default function InboxDigestModal({ open, title, content, onClose }: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(open, panelRef, onClose);

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
              className="group inline-flex max-w-full shrink-0 items-center justify-center rounded text-fg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              aria-label="关闭"
            >
              <span aria-hidden className="text-xl leading-none group-focus-visible:hidden">
                ×
              </span>
              <span
                data-icon-name=""
                className="hidden whitespace-nowrap text-center text-[10px] leading-tight group-focus-visible:block"
              >
                关闭
              </span>
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
