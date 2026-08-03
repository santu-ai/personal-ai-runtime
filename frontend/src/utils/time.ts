/** Shared absolute-time formatting helpers. Relative time lives in ``timeUtils.ts``. */

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
