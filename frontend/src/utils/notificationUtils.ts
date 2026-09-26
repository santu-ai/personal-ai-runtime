/** Strip embedded related-id prefix for notification list previews. */
export function notificationPreview(content: string): string {
  return content.replace(/^\[\[related:[^\]]+\]\]\s*/i, "");
}

/**
 * 字面上仍是标题和正文。读屏在前面写上未读或已读。
 * 两边的空白会去掉，中间的空白和换行仍留着。
 * 标题和正文都是空白时仍只读未读或已读。
 */
export function notificationRowName(
  title: string | null | undefined,
  content: string | null | undefined,
  read: number | null | undefined,
): string {
  const state = read ? "已读" : "未读";
  const heading = (title ?? "").trim();
  const body = notificationPreview(content ?? "").trim();
  const detail = [heading, body].filter(Boolean).join(" ");
  return detail ? `${state} ${detail}` : state;
}
