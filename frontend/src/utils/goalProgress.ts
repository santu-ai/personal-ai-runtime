/**
 * Goal work-item progress is a 0–1 ratio (same rule as GoalsContextFragment).
 * Values above 1 are already percentages.
 */
export function goalProgressPercent(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  const pct = progress <= 1 ? progress * 100 : progress;
  return Math.min(100, pct);
}
