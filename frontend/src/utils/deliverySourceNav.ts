/** Match a cited source id to a delivery source row, and open inbox mail only for email sources. */

const EMAIL_SOURCE_PREFIX = "email:";

export interface DeliverySourceRef {
  id: string;
  type: string;
}

/** Inbox message id for `type=email` sources shaped `email:{message_id}`. */
export function emailMessageId(source: DeliverySourceRef): string | null {
  if (source.type !== "email") return null;
  const id = source.id.trim();
  if (!id.startsWith(EMAIL_SOURCE_PREFIX)) return null;
  const messageId = id.slice(EMAIL_SOURCE_PREFIX.length).trim();
  return messageId || null;
}

/** Exact id match. `email:m1` does not match `email:m10`. */
export function findDeliverySource<T extends { id: string }>(
  sources: readonly T[],
  sourceId: string,
): T | undefined {
  const wanted = sourceId.trim();
  if (!wanted) return undefined;
  return sources.find((source) => source.id === wanted);
}

export function deliverySourceRowId(sourceId: string, index = 0): string {
  return `delivery-source-${index}-${encodeURIComponent(sourceId)}`;
}

/**
 * Sources a citation may open.
 * Rows on the delivery being viewed come first, so a scroll target wins.
 * Email sources that exist only on the compared delivery are appended: inbox
 * detail can still open, but their rows are not on screen. File sources and
 * file-path locators are not added.
 */
export function citationLookupSources<T extends DeliverySourceRef>(
  current: readonly T[],
  compared: readonly DeliverySourceRef[] = [],
): Array<T | DeliverySourceRef> {
  const seen = new Set<string>();
  const currentKept: T[] = [];
  for (const source of current) {
    const id = source.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    currentKept.push({ ...source, id });
  }
  const extra: DeliverySourceRef[] = [];
  for (const source of compared) {
    const id = source.id.trim();
    if (!id || seen.has(id)) continue;
    const normalized: DeliverySourceRef = { id, type: source.type };
    if (!emailMessageId(normalized)) continue;
    seen.add(id);
    extra.push(normalized);
  }
  return extra.length === 0 ? currentKept : [...currentKept, ...extra];
}

export interface DeliveryTextSpan {
  kind: "text" | "source";
  text: string;
}

/**
 * Split delivery body text on backtick tokens.
 * A token becomes a source span only when it exactly matches a source id.
 * File paths and unknown tokens, including their backticks, stay text.
 * `email:m1` does not match `email:m10`.
 */
export function splitBacktickSourceIds(
  content: string,
  sources: readonly { id: string }[],
): DeliveryTextSpan[] {
  const spans: DeliveryTextSpan[] = [];
  const pattern = /`([^`\n]+)`/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const sourceId = (match[1] ?? "").trim();
    const start = match.index ?? 0;
    if (!findDeliverySource(sources, sourceId)) continue;
    if (start > cursor) {
      spans.push({ kind: "text", text: content.slice(cursor, start) });
    }
    spans.push({ kind: "source", text: sourceId });
    cursor = start + match[0].length;
  }
  if (cursor < content.length || spans.length === 0) {
    spans.push({ kind: "text", text: content.slice(cursor) });
  }
  return spans;
}

/** Scroll the first row whose `data-delivery-source-id` equals `sourceId`. */
export function scrollToDeliverySource(sourceId: string, root: ParentNode = document): boolean {
  const wanted = sourceId.trim();
  if (!wanted) return false;
  const nodes = root.querySelectorAll("[data-delivery-source-id]");
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute("data-delivery-source-id") !== wanted) continue;
    node.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }
  return false;
}
