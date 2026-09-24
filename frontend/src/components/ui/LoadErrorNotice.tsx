import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import Spinner from "./Spinner";

/** 有原文用原文。空白或不是 Error 时用页面自己的说法，避免把读失败写成空列表。 */
export function queryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

/**
 * 首次失败时缓存里没有数据。重试一开始可能把查询错误清掉，这里留住原因，
 * 按钮才不会被「加载中」换掉。scope 变了（例如换了一条详情）就不再沿用上一条原因。
 */
export function useHeldQueryError(
  hasData: boolean,
  error: unknown,
  isFetching: boolean,
  fallback: string,
  scope: string,
): string | null {
  const message = error ? queryErrorMessage(error, fallback) : null;
  const [held, setHeld] = useState<{ scope: string; message: string } | null>(null);

  useEffect(() => {
    if (hasData || (!error && !isFetching)) {
      setHeld(null);
      return;
    }
    if (message) setHeld({ scope, message });
  }, [hasData, error, isFetching, message, scope]);

  if (hasData) return null;
  if (message) return message;
  if (isFetching && held?.scope === scope) return held.message;
  return null;
}

export default function LoadErrorNotice({
  message,
  busy,
  onRetry,
  testId,
  autoFocus = true,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  testId: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const root = ref.current;
    const button = root?.querySelector("button");
    if (!root || !button || root.contains(document.activeElement)) return;
    button.focus();
  }, [autoFocus, message]);

  return (
    <div
      ref={ref}
      className="space-y-2 rounded-xl border border-danger/30 p-4"
      data-testid={testId}
      role="alert"
    >
      <p className="text-sm text-danger">{message}</p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-busy={busy || undefined}
        onClick={() => {
          if (busy) return;
          onRetry();
        }}
      >
        {busy ? (
          <span aria-hidden="true" className="inline-flex">
            <Spinner size="sm" />
          </span>
        ) : null}
        重试
      </Button>
    </div>
  );
}
