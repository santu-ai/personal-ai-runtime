import { lazy, Suspense } from "react";

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
  return (
    <Suspense
      fallback={
        <pre className="bg-surface-sunken rounded p-3 text-xs overflow-x-auto">
          <code>{code}</code>
        </pre>
      }
    >
      <LazySyntaxBlock language={language} code={code} />
    </Suspense>
  );
}
