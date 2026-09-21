import Link from "next/link";
import { WORK } from "@/lib/routes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkOverviewRow } from "../dto";
import { SprintProgress, sprintTiming } from "./sprint-progress";
import { StatusBars } from "./status-bars";

/** One product board on the work overview. */
export function BoardCard({ row }: { row: WorkOverviewRow }) {
  const c = row.counts;
  const open = c.todo + c.in_progress + c.in_review;
  const s = row.activeSprint;
  return (
    <Link href={WORK.board(row.product.slug)} className="block h-full">
      <Card className="h-full gap-3 py-5 transition-colors hover:border-primary/50">
        <CardHeader className="gap-1">
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: row.product.color ?? "var(--primary)" }} />
            <span className="font-mono text-[11px] text-heading">{row.board?.keyPrefix ?? "—"}</span>
            <Badge variant="outline" className="text-[10px]">
              {row.board ? (row.board.mode === "sprints" ? `${row.board.sprintLengthDays}-day sprints` : "kanban") : "no board yet"}
            </Badge>
          </CardDescription>
          <CardTitle className="text-lg">{row.product.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
          <StatusBars counts={c} />
          {row.myOpen > 0 && <span className="text-primary">{row.myOpen} mine</span>}
          {s ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-heading">{s.name}</span>
                <span className={s.isOverdue ? "text-warning" : undefined}>
                  {s.done}/{s.total} done · {sprintTiming(s)}
                </span>
              </div>
              <SprintProgress done={s.done} total={s.total} />
            </div>
          ) : (
            <span>{row.board?.mode === "sprints" ? "No active sprint" : `${open} open on the board`}</span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
