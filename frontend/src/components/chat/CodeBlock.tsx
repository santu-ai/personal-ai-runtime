import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Check, Copy } from "lucide-react";
import { isImeKeyboardEvent } from "../../utils/imeKey";

/** 某一行超过这么多个字，横向滚动会把后面藏起来。 */
const CODE_LINE_CHARS = 80;

function codeLineNeedsReveal(code: string): boolean {
  return code.split("\n").some((line) => line.length > CODE_LINE_CHARS);
}

/** 空格和回车不把页面滚走。组字或输入法处理键时这一下不拦住。 */
function keepCodeKeysFromScrolling(event: KeyboardEvent<HTMLElement>) {
  if (isImeKeyboardEvent(event.nativeEvent)) return;
  if (event.key === "Enter" || event.key === " ") event.preventDefault();
}

const CodeSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CodeSurface(
  { className, children, ...rest },
  ref,
) {
  return (
    <div
      {...rest}
      ref={ref}
      data-code-surface=""
      className={["overflow-x-auto", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
});

const LazySyntaxBlock = lazy(async () => {
  const [{ PrismAsyncLight }, { oneDark }] = await Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism"),
  ]);
  return {
    default: function SyntaxBlock({ language, code }: { language: string; code: string }) {
      return (
        <PrismAsyncLight style={oneDark} language={language} PreTag={CodeSurface}>
          {code}
        </PrismAsyncLight>
      );
    },
  };
});

export function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const handleCopy = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
      if (!write) return;
      // 失败时不写成已复制，也不让未接住的拒绝冒到控制台。
      void write(code).then(
        () => {
          setCopied(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = null;
            setCopied(false);
          }, 2000);
        },
        () => {
          setCopied(false);
        },
      );
    },
    [code],
  );

  const copyLabel = copied ? "已复制" : "复制";
  const reveal = codeLineNeedsReveal(code);
  const surface = (
    <Suspense
      fallback={
        <pre data-code-surface="" className="bg-surface-sunken overflow-x-auto rounded p-3 text-xs">
          <code>{code}</code>
        </pre>
      }
    >
      <LazySyntaxBlock language={language} code={code} />
    </Suspense>
  );

  return (
    <div className="group relative">
      <button
        type="button"
        data-code-block-copy=""
        onClick={handleCopy}
        // 只在悬停时出现的话，键盘落到这一钮时整颗都是透明的，焦点环也看不见。
        className="group absolute top-2 right-2 z-10 inline-flex max-w-full items-center justify-center rounded p-1 opacity-0 bg-surface-overlay hover:bg-border-strong transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? (
          <Check
            size={14}
            aria-hidden
            className="shrink-0 text-success group-focus-visible:hidden"
          />
        ) : (
          <Copy
            size={14}
            aria-hidden
            className="shrink-0 text-fg-secondary group-focus-visible:hidden"
          />
        )}
        <span
          data-icon-name=""
          className="hidden whitespace-nowrap text-center text-[10px] leading-tight group-focus-visible:block"
        >
          {copyLabel}
        </span>
      </button>
      {reveal ? (
        <div
          tabIndex={0}
          data-code-reveal=""
          title={code}
          onKeyDown={keepCodeKeysFromScrolling}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {/* 平时横向滚动。键盘落到时写出整段并换行。鼠标悬停仍要横向滚动，整段在 title 里。 */}
          {surface}
        </div>
      ) : (
        surface
      )}
    </div>
  );
}
