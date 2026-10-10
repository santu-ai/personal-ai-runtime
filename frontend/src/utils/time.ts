/** Shared absolute-time formatting helpers. Relative time lives in ``timeUtils.ts``. */

export function formatTime(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return iso;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
