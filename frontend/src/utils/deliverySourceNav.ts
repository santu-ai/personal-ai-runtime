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
