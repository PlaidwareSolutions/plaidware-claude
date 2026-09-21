import { cn } from "@/lib/utils";

const STAGES = [
  { key: "backlog", label: "backlog" },
  { key: "todo", label: "to do" },
  { key: "in_progress", label: "in progress" },
  { key: "in_review", label: "in review" },
] as const;

type Counts = Record<(typeof STAGES)[number]["key"], number>;

/**
 * The board's open work by stage as four thin bars, scaled to the card's own
 * largest count, with the number above each bar and the stage below. One
 * series, so the theme's primary hue carries no identity — the labels do —
 * and a zero shows as a hairline stub so every stage still reads.
 */
export function StatusBars({ counts, className }: { counts: Counts; className?: string }) {
  const max = Math.max(1, ...STAGES.map((s) => counts[s.key]));
  const summary = STAGES.map((s) => `${counts[s.key]} ${s.label}`).join(", ");
  return (
    <div className={cn("flex flex-col gap-1", className)} role="img" aria-label={`Items by stage: ${summary}`}>
      <div className="grid grid-cols-4 items-end gap-2">
        {STAGES.map((s) => {
          const n = counts[s.key];
          return (
            <div key={s.key} className="flex flex-col items-center gap-1" title={`${n} ${s.label}`}>
              <span className="text-xs font-medium tabular-nums text-heading">{n}</span>
              <div className="flex h-10 w-full items-end px-2">
                <div
                  className={cn("w-full rounded-t-[4px]", n > 0 ? "bg-primary/80" : "bg-muted-foreground/25")}
                  style={{ height: n > 0 ? `${Math.max(6, Math.round((n / max) * 100))}%` : "2px" }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-4 gap-2 border-t pt-1">
        {STAGES.map((s) => (
          <span key={s.key} className="truncate text-center text-[10px] leading-tight text-muted-foreground">
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
