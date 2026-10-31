import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { listAllTenants } from "@/modules/tenancy/queries";
import { listBoardEpics, listWorkAssignees } from "@/modules/work/queries";
import { NewItemDialog } from "@/modules/work/components/new-item-dialog";
import { WorkTabs } from "@/modules/work/components/work-tabs";
import { BoardHeaderActions, BoardTitleMenu } from "@/modules/work/components/board-header-actions";
import { sprintTiming } from "@/modules/work/components/sprint-progress";
import { WORK } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { loadBoard } from "./load";

/**
 * A company's board header, laid out like Jira's: "Spaces / Fixorata"
 * breadcrumb, "<Company> board" title with its ⋯ menu, Create + share /
 * refresh / full-screen on the right, then the icon tabs.
 */
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
  const [assignees, tenants, epics] = await Promise.all([listWorkAssignees(), isOps ? listAllTenants() : Promise.resolve([]), listBoardEpics(board.id)]);
  const s = board.activeSprint;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Link href={WORK.all} className="hover:text-foreground hover:underline">
              Spaces
            </Link>
            <span aria-hidden>/</span>
            <Link href={WORK.board(slug)} className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline">
              <span className="inline-flex size-4 items-center justify-center rounded-[3px] text-[9px] font-bold text-white" style={{ background: board.product.color ?? "var(--primary)" }} aria-hidden>
                {board.product.name[0]?.toUpperCase()}
              </span>
              {board.product.name}
            </Link>
          </nav>
        }
        title={`${board.product.name} board`}
        badge={
          <>
            <BoardTitleMenu backlogHref={WORK.backlog(slug)} settingsHref={canManage ? WORK.settings(slug) : undefined} />
            {board.mode === "sprints" &&
              (s ? <StatusBadge kind="sprint" status="active" label={`${s.name} · ${sprintTiming(s)}`} /> : <StatusBadge kind="sprint" status="planned" label="no active sprint" />)}
          </>
        }
        actions={
          <>
            <NewItemDialog
              boardId={board.id}
              slug={slug}
              assignees={assignees}
              epics={epics}
              canLinkClient={isOps}
              tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
              defaultStatus="todo"
              hotkey
              trigger={
                <Button size="sm" className="h-8 gap-1.5 rounded-[3px] bg-info font-semibold text-white hover:bg-info/90 dark:text-background">
                  <Plus className="size-4" /> Create
                </Button>
              }
            />
            <BoardHeaderActions label={`the ${board.product.name} board`} />
          </>
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
