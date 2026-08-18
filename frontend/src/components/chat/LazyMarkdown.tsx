import { lazy, Suspense, useMemo } from "react";
import type { Components } from "react-markdown";

const LazyMarkdownRenderer = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }, { default: remarkBreaks }] =
    await Promise.all([import("react-markdown"), import("remark-gfm"), import("remark-breaks")]);

  return {
    default: function MarkdownRenderer({
      content,
      components,
    }: {
      content: string;
      components: Components;
    }) {
      return (
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
          {content}
        </ReactMarkdown>
      );
    },
  };
});

export function LazyMarkdown({ content, components }: { content: string; components: Components }) {
  const stableComponents = useMemo(() => components, [components]);
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>}>
      <LazyMarkdownRenderer content={content} components={stableComponents} />
    </Suspense>
  );
}
