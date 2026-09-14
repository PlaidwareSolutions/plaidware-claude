/**
 * Tiny inline trend line. Auto-scales to the data unless `max` is given
 * (Lighthouse scores pass max={100}). Renders `emptyLabel` (or nothing when
 * null) with fewer than two points.
 */
export function Sparkline({
  data,
  max,
  className = "h-8 w-full",
  emptyLabel = "no data yet",
}: {
  data: (number | null)[];
  max?: number;
  className?: string;
  emptyLabel?: string | null;
}) {
  const vals = data.map((d) => d ?? 0);
  const empty = vals.length < 2 || (max == null && vals.every((v) => v === 0));
  if (empty) {
    return emptyLabel == null ? null : <div className="h-8 text-[10px] text-muted-foreground">{emptyLabel}</div>;
  }
  const scale = max ?? Math.max(...vals) ?? 1;
  const denom = scale || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${30 - (Math.min(v, denom) / denom) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 32" className={className} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
