import { useEffect, useState } from "react";
import {
  getMemoryProvenance,
  ApiError,
  type MemoryRow,
  type MemoryProvenance,
} from "../../api/client";
import { useErrorStore } from "../../stores/errorStore";
import { timeAgoShort } from "../../utils/timeUtils";
import { eventTypeLabel, eventDescription } from "./provenanceFormatting";
import { History } from "lucide-react";

interface Props {
  target: MemoryRow;
  onClose: () => void;
}

export default function MemoryProvenanceDialog({ target, onClose }: Props) {
  const addError = useErrorStore((s) => s.addError);
  const [data, setData] = useState<MemoryProvenance | null>(null);
  const [loading, setLoading] = useState(true);

  // Load on mount; provenance state stays scoped to this dialog instead of
  // being carried by every memory row in the parent.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMemoryProvenance(target.id);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          addError(err instanceof ApiError ? err.message : "加载来源链失败", "记忆");
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target.id, addError, onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-strong rounded-xl p-6 w-[32rem] max-w-[90vw] max-h-[80vh] overflow-y-auto space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-insight" />
          <h3 className="text-lg font-semibold text-fg-primary">记忆来源链</h3>
        </div>
        <p className="text-sm text-fg-secondary italic">{target.content}</p>
        {loading ? (
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
                <p className="text-sm text-fg-primary mt-0.5">{eventDescription(e)}</p>
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
