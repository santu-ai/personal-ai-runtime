import type { MemoryProvenanceEvent } from "../../api/client";

const EVENT_TYPE_LABELS: Record<string, string> = {
  MemoryDerived: "生成",
  MemoryUpdated: "更新",
  MemoryDecayed: "衰减",
  MemoryDeleted: "删除",
  MemoryRevoked: "撤销",
  MemoryIndexRepairFailed: "索引修复失败",
};

/** 更新正文平时只写出这么多字。键盘落到时才换成整句。 */
export const PROVENANCE_UPDATE_PREVIEW = 60;
/** 索引修复失败原因平时只写出这么多字。 */
export const PROVENANCE_REPAIR_PREVIEW = 80;

export interface ProvenanceSentence {
  /** 平时看见的那一句。短的和整句相同。 */
  preview: string;
  /** 整句。和 preview 不同时，键盘落到才换上。 */
  full: string;
}

function same(text: string): ProvenanceSentence {
  return { preview: text, full: text };
}

function clipped(prefix: string, body: string, limit: number, suffix: string): ProvenanceSentence {
  const full = `${prefix}${body}${suffix}`;
  if (body.length <= limit) return same(full);
  return { preview: `${prefix}${body.slice(0, limit)}…${suffix}`, full };
}

export function eventTypeLabel(t: string): string {
  return EVENT_TYPE_LABELS[t] || t;
}

/** 来源链里这一行平时写出的句子。超长的更新和修复原因仍是前一段。 */
export function eventDescription(e: MemoryProvenanceEvent): string {
  return provenanceSentence(e).preview;
}

export function provenanceSentence(e: MemoryProvenanceEvent): ProvenanceSentence {
  const p = e.payload as Record<string, unknown>;
  const conf = p.confidence;
  const content = typeof p.content === "string" ? p.content : "";
  switch (e.type) {
    case "MemoryDerived":
      return same(
        `由 ${e.actor} 抽取${typeof conf === "number" ? `，置信度 ${conf.toFixed(2)}` : ""}`,
      );
    case "MemoryUpdated":
      if (content) {
        return clipped(`内容由 ${e.actor} 更新为「`, content, PROVENANCE_UPDATE_PREVIEW, "」");
      }
      return same(`内容被 ${e.actor} 更新`);
    case "MemoryDecayed":
      return same(typeof conf === "number" ? `置信度衰减至 ${conf.toFixed(2)}` : "置信度衰减");
    case "MemoryDeleted":
      return same(`被 ${e.actor} 删除`);
    case "MemoryRevoked":
      return same(`被 ${e.actor} 撤销`);
    case "MemoryIndexRepairFailed": {
      const err = typeof p.error === "string" ? p.error : "";
      if (!err) return same("向量索引修复失败，记忆可能无法语义召回");
      return clipped("向量索引修复失败：", err, PROVENANCE_REPAIR_PREVIEW, "");
    }
    default:
      return same(`${e.actor}`);
  }
}
