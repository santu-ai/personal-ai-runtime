import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  getMemoryProvenance,
  type MemoryProvenance,
  type MemoryProvenanceEvent,
  type MemoryRow,
} from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { isImeKeyboardEvent } from "../../utils/imeKey";
import { timeAgoShort } from "../../utils/timeUtils";
import { eventTypeLabel, provenanceSentence } from "./provenanceFormatting";
import { History } from "lucide-react";
import LoadErrorNotice, { queryErrorMessage, useHeldQueryError } from "../ui/LoadErrorNotice";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";

interface Props {
  target: MemoryRow;
  onClose: () => void;
}

/** 空格和回车不把页面滚走。组字或输入法处理键时这一下不拦住。 */
function keepProvenanceKeysFromScrolling(event: KeyboardEvent<HTMLElement>) {
  if (isImeKeyboardEvent(event.nativeEvent)) return;
  if (event.key === "Enter" || event.key === " ") event.preventDefault();
}

function ProvenanceSentenceView({ event }: { event: MemoryProvenanceEvent }) {
  const line = provenanceSentence(event);
  if (line.preview === line.full) {
    return <p className="mt-0.5 text-sm text-fg-primary">{line.full}</p>;
  }
  return (
    <p
      tabIndex={0}
      title={line.full}
      data-provenance-preview=""
      onKeyDown={keepProvenanceKeysFromScrolling}
      className="group mt-0.5 rounded-sm text-sm text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {/* 平时写出前一段。键盘落到这一句时写出整句。鼠标悬停仍是前一段。 */}
      <span className="group-focus-visible:hidden">{line.preview}</span>
      <span className="hidden whitespace-pre-wrap break-words group-focus-visible:block">
        {line.full}
      </span>
    </p>
  );
}

export default function MemoryProvenanceDialog({ target, onClose }: Props) {
  const addError = useErrorStore((s) => s.addError);
  const [data, setData] = useState<MemoryProvenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const memoryId = target.id;
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlayDismiss(true, panelRef, onClose, { focusKey: memoryId });
  const [trackedId, setTrackedId] = useState(memoryId);
  // 换一条记忆时先丢掉上一条的失败，避免那条原因被记到新记忆上。
  if (memoryId !== trackedId) {
    setTrackedId(memoryId);
    setData(null);
    setLoadError(null);
    setLoading(true);
    setAttempt(0);
  }
  // 重试会把这次错误清掉。原因留在对话框里，避免改回「加载中...」。
  const shownError = useHeldQueryError(
    data !== null,
    loadError,
    loading,
    "加载来源链失败",
    memoryId,
  );

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await getMemoryProvenance(memoryId);
        if (cancelled) return;
        setData(result);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err);
        addError(queryErrorMessage(err, "加载来源链失败"), "记忆");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memoryId, attempt, addError]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-provenance-title"
        tabIndex={-1}
        className="bg-surface-raised border border-border-strong rounded-xl p-6 w-[32rem] max-w-[90vw] max-h-[80vh] overflow-y-auto space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-insight" />
          <h3 id="memory-provenance-title" className="text-lg font-semibold text-fg-primary">
            记忆来源链
          </h3>
        </div>
        <p className="text-sm text-fg-secondary italic">{target.content}</p>
        {shownError ? (
          <LoadErrorNotice
            message={shownError}
            busy={loading}
            onRetry={() => {
              if (loading) return;
              setAttempt((value) => value + 1);
            }}
            testId="memory-provenance-load-error"
          />
        ) : loading ? (
          <p className="text-sm text-fg-tertiary">加载中...</p>
        ) : data && data.events.length > 0 ? (
          <ol className="space-y-3 border-l border-border-strong pl-4">
            {data.events.map((e) => (
              <li key={e.seq} className="relative">
                <span className="absolute -left-[1.4rem] top-1 w-2 h-2 rounded-full bg-insight" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-insight bg-insight/15 px-1.5 py-0.5 rounded">
                    {eventTypeLabel(e.type)}
                  </span>
                  <span className="text-xs text-fg-tertiary">{timeAgoShort(e.ts)}</span>
                </div>
                <ProvenanceSentenceView event={e} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-fg-tertiary">无事件记录</p>
        )}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-surface-overlay hover:bg-border-strong rounded-lg text-sm text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
