import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

const LazySyntaxBlock = lazy(async () => {
  const [{ PrismAsyncLight }, { oneDark }] = await Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism"),
  ]);
  return {
    default: function SyntaxBlock({ language, code }: { language: string; code: string }) {
      return (
        <PrismAsyncLight style={oneDark} language={language} PreTag="div">
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
    (e: React.MouseEvent) => {
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
      <Suspense
        fallback={
          <pre className="bg-surface-sunken rounded p-3 text-xs overflow-x-auto">
            <code>{code}</code>
          </pre>
        }
      >
        <LazySyntaxBlock language={language} code={code} />
      </Suspense>
    </div>
  );
}
