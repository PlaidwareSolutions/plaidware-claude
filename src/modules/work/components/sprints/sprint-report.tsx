import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WORK } from "@/lib/routes";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Sparkline } from "@/components/sparkline";
import type { WorkSprintReportDto } from "../../dto";
import { ItemRowList } from "../item-row";
import { SprintProgress, sprintTiming } from "../sprint-progress";

/** One sprint: what was committed, what shipped, what carried, and the board's velocity. */
export function SprintReport({ slug, report }: { slug: string; report: WorkSprintReportDto }) {
  const s = report.sprint;
  const total = report.done.length + report.remaining.length;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={WORK.sprints(slug)} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Sprints
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-heading">{s.name}</h2>
          <StatusBadge kind="sprint" status={s.status} />
          <span className={`text-sm ${s.isOverdue ? "text-warning" : "text-muted-foreground"}`}>
            {formatDate(s.startsOn)} – {formatDate(s.endsOn)} · {sprintTiming(s)}
          </span>
        </div>
        {s.goal && <p className="text-sm text-muted-foreground">{s.goal}</p>}
        {s.status !== "planned" && <SprintProgress done={report.done.length} total={Math.max(total, s.committedCount ?? 0)} className="max-w-md" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Committed" value={s.committedPoints ?? "—"} sub={s.committedCount != null ? `${s.committedCount} items at start` : "snapshot taken at start"} />
        <StatTile label="Completed" value={s.status === "completed" ? (s.completedPoints ?? 0) : report.done.reduce((n, c) => n + (c.estimatePoints ?? 0), 0)} sub={`${report.done.length} item${report.done.length === 1 ? "" : "s"} done`} tone="success" />
        <StatTile label="Carried out" value={report.carriedOut.length} sub="moved on at completion" tone={report.carriedOut.length ? "warning" : "default"} />
        <StatTile
          label="Velocity"
          value={report.velocity ?? "—"}
          sub={report.history.length ? `avg points, last ${Math.min(3, report.history.length)} completed` : "needs a completed sprint"}
        />
      </div>

      {report.history.length > 1 && (
        <Section title="Completed points by sprint" description={report.history.map((h) => h.name).join(" · ")}>
          <div className="rounded-lg border bg-card p-4">
            <Sparkline data={report.history.map((h) => h.completedPoints)} className="h-12 w-full" />
          </div>
        </Section>
      )}

      <Section title="Done" count={report.done.length}>
        {report.done.length ? <ItemRowList cards={report.done} slug={slug} showStatus={false} /> : <EmptyState compact title="Nothing finished yet" />}
      </Section>
      {report.remaining.length > 0 && (
        <Section title={s.status === "completed" ? "Still on this sprint" : "Remaining"} count={report.remaining.length}>
          <ItemRowList cards={report.remaining} slug={slug} />
        </Section>
      )}
      {report.carriedOut.length > 0 && (
        <Section title="Carried out" description="unfinished when the sprint completed" count={report.carriedOut.length}>
          <ItemRowList cards={report.carriedOut} slug={slug} />
        </Section>
      )}
      <p className="text-xs text-muted-foreground">
        {s.startedAt && <>Started {formatDateTime(s.startedAt)}. </>}
        {s.completedAt && <>Completed {formatDateTime(s.completedAt)}.</>}
      </p>
    </div>
  );
}
