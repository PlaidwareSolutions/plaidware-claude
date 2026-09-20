import Link from "next/link";
import { Package } from "lucide-react";
import { requireWorkPage, workViewer } from "@/policy";
import { listActiveSprints, listBoardsOverview } from "@/modules/work/queries";
import { BoardCard } from "@/modules/work/components/board-card";
import { SprintProgress, sprintTiming } from "@/modules/work/components/sprint-progress";
import { WORK } from "@/lib/routes";
import { formatDay } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Work" };
export const dynamic = "force-dynamic";

export default async function WorkHomePage() {
  const session = await requireWorkPage();
  const viewer = workViewer(session);
  const [boards, sprints] = await Promise.all([listBoardsOverview(viewer), listActiveSprints()]);

  const sum = (k: keyof (typeof boards)[number]["counts"]) => boards.reduce((s, b) => s + b.counts[k], 0);
  const open = sum("todo") + sum("in_progress") + sum("in_review");
  const mine = boards.reduce((s, b) => s + b.myOpen, 0);
  const overdue = sprints.filter((s) => s.isOverdue).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Work" description="Every product board and what's in flight." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open items" value={open} sub={`${sum("backlog")} waiting in backlogs`} />
        <StatTile label="In progress" value={sum("in_progress")} sub={`${sum("in_review")} in review`} />
        <StatTile
          label="My items"
          value={mine}
          href={WORK.my}
          tone={mine > 0 ? "default" : "success"}
          sub={mine > 0 ? "assigned to you" : "nothing assigned to you"}
        />
        <StatTile
          label="Active sprints"
          value={sprints.length}
          tone={overdue > 0 ? "warning" : "default"}
          sub={overdue > 0 ? `${overdue} past the end date` : sprints[0] ? `next ends ${formatDay(sprints[0].endsOn)}` : "none running"}
        />
      </div>

      {sprints.length > 0 && (
        <Section title="Active sprints" count={sprints.length}>
          <div className="grid gap-3 md:grid-cols-2">
            {sprints.map((s) => (
              <Link
                key={s.id}
                href={WORK.sprint(s.product.slug, s.id)}
                className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/50"
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.product.color ?? "var(--primary)" }} />
                    <span className="truncate font-medium text-heading">{s.product.name}</span>
                    <span className="truncate text-muted-foreground">{s.name}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${s.isOverdue ? "text-warning" : "text-muted-foreground"}`}>
                    {s.done}/{s.total} done · {sprintTiming(s)}
                  </span>
                </div>
                <SprintProgress done={s.done} total={s.total} />
                {s.goal && <p className="truncate text-xs text-muted-foreground">{s.goal}</p>}
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Boards" count={boards.length}>
        {boards.length === 0 ? (
          <EmptyState icon={Package} title="No products yet" description="A board appears here for every active product in the catalog." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((b) => (
              <BoardCard key={b.product.id} row={b} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
