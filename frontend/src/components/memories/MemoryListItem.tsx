import type { MemoryRow } from "../../api/client";
import { timeAgoShort } from "../../utils/timeUtils";
import { Check, X, Edit3, FileText, History } from "lucide-react";

export const CATEGORY_LABELS: Record<string, { title: string; icon: string }> = {
  preference: { title: "你的偏好", icon: "💜" },
  habit: { title: "你的习惯", icon: "🔄" },
  fact: { title: "关于你", icon: "📌" },
  goal: { title: "你的目标", icon: "🎯" },
  event: { title: "你经历过的事", icon: "📅" },
  note: { title: "其他", icon: "📝" },
};

export function getCategoryMeta(cat: string) {
  return CATEGORY_LABELS[cat] ?? { title: cat, icon: "📝" };
}

interface Props {
  memory: MemoryRow;
  onRatify: (m: MemoryRow) => void;
  onReject: (m: MemoryRow) => void;
  onEdit: (m: MemoryRow) => void;
  onDelete: (m: MemoryRow) => void;
  onContinueChat: (m: MemoryRow) => void;
  onShowProvenance: (m: MemoryRow) => void;
}

export default function MemoryListItem({
  memory: m,
  onRatify,
  onReject,
  onEdit,
  onDelete,
  onContinueChat,
  onShowProvenance,
}: Props) {
  return (
    <li className="bg-surface-raised border border-border-subtle rounded-lg p-3 text-sm group">
      <p className="text-fg-primary">{m.content}</p>
      {m.source_document_name && (
        <a
          href={`#/knowledge`}
          className="inline-flex items-center gap-1 mt-1.5 text-xs text-insight hover:text-insight/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
          title={m.source_document_id || ""}
        >
          <FileText size={10} />
          <span>源自：《{m.source_document_name}》</span>
        </a>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {m.created_at && (
          <span className="text-xs text-fg-disabled">{timeAgoShort(m.created_at)}</span>
        )}
        {m.origin === "claim" && <span className="text-xs text-insight/70">对话推断</span>}
        {m.origin === "self_report" && (
          <span className="text-xs text-success/70">你告诉我的</span>
        )}
        {m.claim_status === "proposed" && (
          <span className="text-xs bg-warning/15 text-warning px-1.5 py-0.5 rounded">
            待确认
          </span>
        )}
        {m.claim_status === "ratified" && (
          <span className="text-xs bg-success/15 text-success px-1.5 py-0.5 rounded">
            已确认
          </span>
        )}
        {m.claim_status === "rejected" && (
          <span className="text-xs bg-danger/15 text-danger px-1.5 py-0.5 rounded">已拒绝</span>
        )}
        {m.claim_status === "contested" && (
          <span className="text-xs bg-insight/15 text-insight px-1.5 py-0.5 rounded">
            有争议
          </span>
        )}
        {m.origin === "claim" && m.claim_status === "proposed" && (
          <>
            <button
              onClick={() => onRatify(m)}
              className="text-xs text-success hover:text-success/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
            >
              <Check size={14} className="inline mr-0.5" />
              确认
            </button>
            <button
              onClick={() => onReject(m)}
              className="text-xs text-fg-secondary hover:text-fg-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
            >
              <X size={14} className="inline mr-0.5" />
              拒绝
            </button>
          </>
        )}
        <button
          onClick={() => onEdit(m)}
          className="text-xs text-insight hover:text-insight/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          <Edit3 size={14} className="inline mr-0.5" />
          编辑
        </button>
        <button
          onClick={() => onContinueChat(m)}
          className="text-xs text-fg-secondary hover:text-fg-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          继续聊
        </button>
        <button
          onClick={() => onShowProvenance(m)}
          className="text-xs text-insight hover:text-insight/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          <History size={11} className="inline mr-0.5" />
          来源
        </button>
        <button
          onClick={() => onDelete(m)}
          className="text-xs text-fg-tertiary hover:text-danger opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded"
        >
          忘掉
        </button>
      </div>
    </li>
  );
}
