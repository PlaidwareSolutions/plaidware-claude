import { notFound } from "next/navigation";
import { listAllTenants } from "@/modules/tenancy/queries";
import { listWorkAssignees } from "@/modules/work/queries";
import { NewItemDialog } from "@/modules/work/components/new-item-dialog";
import { WorkTabs } from "@/modules/work/components/work-tabs";
import { sprintTiming } from "@/modules/work/components/sprint-progress";
import { WORK } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { loadBoard } from "./load";

export default async function BoardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { board, canManage, isOps } = await loadBoard(slug);
  if (!board) notFound();
  const [assignees, tenants] = await Promise.all([listWorkAssignees(), isOps ? listAllTenants() : Promise.resolve([])]);
  const s = board.activeSprint;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: WORK.home, label: "Work" }}
        title={
          <span className="inline-flex items-center gap-2">
            <span className="size-3 rounded-full" style={{ background: board.product.color ?? "var(--primary)" }} />
            {board.product.name}
          </span>
        }
        badge={
          <>
            <Badge variant="outline" className="font-mono">{board.keyPrefix}</Badge>
            {board.mode === "sprints" &&
              (s ? (
                <StatusBadge kind="sprint" status="active" label={s.name} />
              ) : (
                <StatusBadge kind="sprint" status="planned" label="no active sprint" />
              ))}
          </>
        }
        meta={
          board.mode === "sprints"
            ? `${board.sprintLengthDays}-day sprints${s ? ` · ${sprintTiming(s)}` : ""} · ${board.counts.open} open`
            : `Kanban · ${board.counts.open} open`
        }
        actions={
          <NewItemDialog
            boardId={board.id}
            slug={slug}
            assignees={assignees}
            canLinkClient={isOps}
            tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
          />
        }
      >
        <WorkTabs
          slug={slug}
          mode={board.mode}
          canManage={canManage}
          counts={{ backlog: board.counts.backlog, sprints: board.counts.plannedSprints + (s ? 1 : 0) }}
        />
      </PageHeader>
      {children}
    </div>
  );
}
