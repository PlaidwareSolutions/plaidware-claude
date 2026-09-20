import { cn } from "@/lib/utils";

/** "3d left" / "ends today" / "2d overdue" for a sprint DTO. */
export function sprintTiming(s: { status: string; daysLeft: number; isOverdue: boolean }): string {
  if (s.status === "completed") return "completed";
  if (s.status === "planned") return s.daysLeft > 0 ? `starts in ${s.daysLeft}d` : "ready to start";
  if (s.isOverdue) return `${-s.daysLeft}d overdue`;
  if (s.daysLeft === 0) return "ends today";
  return `${s.daysLeft}d left`;
}

/** Thin done/total bar. */
export function SprintProgress({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded bg-accent", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded", pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}
