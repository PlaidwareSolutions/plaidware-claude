import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { listAllTenants } from "@/modules/tenancy/queries";
import { getBoardView, getExplorerView, getItem } from "@/modules/work/queries";
import { parseExplorerFilters, parseItemRef } from "@/modules/work/explorer-logic";
import { ExplorerToolbar } from "@/modules/work/components/explorer/explorer-toolbar";
import { ExplorerBoard } from "@/modules/work/components/explorer/explorer-board";
import { ExplorerList } from "@/modules/work/components/explorer/explorer-list";
import { ItemPeek } from "@/modules/work/components/item/item-peek";
import { ItemRowList } from "@/modules/work/components/item-row";
import { WORK } from "@/lib/routes";
import { Section } from "@/components/section";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { boardMetadata, loadBoard } from "./load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return boardMetadata(params, "Board");
}

/**
 * A company's board: the All work board fixed to this company (same toolbar,
 * swimlanes, list view and quick view). Sprints boards show the active sprint,
 * plus the board's unscheduled items underneath.
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { board, viewer, isOps, canManage, session } = await loadBoard(slug);
  if (!board) notFound();
  const filters = { ...parseExplorerFilters(await searchParams), product: [slug] };
  const ref = parseItemRef(filters.item);
  const peekNumber = ref?.slug === slug ? ref.number : undefined;
  const sprints = board.mode === "sprints";

  const [view, peekItem, tenants, sprintView] = await Promise.all([
    getExplorerView(viewer, filters, { sprintId: sprints ? (board.activeSprint?.id ?? null) : undefined }),
    peekNumber ? getItem(board.id, peekNumber, viewer) : Promise.resolve(null),
    isOps ? listAllTenants() : Promise.resolve([]),
    sprints ? getBoardView(board.id, viewer) : Promise.resolve(null),
  ]);
  const products = view.products.filter((p) => p.slug === slug);
  const noSprint = sprints && !board.activeSprint && filters.view === "board";

  return (
    <div className="group flex flex-col gap-4">
      <ExplorerToolbar
        base={WORK.board(slug)}
        lockProduct
        filters={filters}
        clients={view.clients}
        assignees={view.assignees}
        labels={view.labels}
        epics={view.epics}
        viewerId={viewer.userId}
        extra={
          sprints && board.activeSprint ? (
            <Button asChild size="sm" className="h-9 rounded-[3px] bg-info font-semibold text-white hover:bg-info/90 dark:text-background">
              <Link href={WORK.sprint(slug, board.activeSprint.id)}>Complete sprint</Link>
            </Button>
          ) : undefined
        }
      />
      {noSprint ? (
        <EmptyState
          icon={CalendarRange}
          title="No active sprint"
          description="This board runs in sprints. Plan one from the backlog, start it, and it shows up here."
          action={
            <Button asChild size="sm">
              <Link href={WORK.sprints(slug)}>Plan a sprint</Link>
            </Button>
          }
        />
      ) : filters.view === "list" ? (
        <ExplorerList base={WORK.board(slug)} cards={view.cards} filters={filters} assignees={view.assignees} productOrder={[slug]} />
      ) : (
        <ExplorerBoard
          cards={view.cards}
          filters={filters}
          products={products}
          assignees={view.assignees}
          viewerId={viewer.userId}
          canLinkClient={isOps}
          doneWindowDays={view.doneWindowDays}
          doneCaption={sprints ? "this sprint" : undefined}
          showBacklog={!sprints}
        />
      )}
      {sprintView && sprintView.unscheduled.length > 0 && (
        <Section title="Unscheduled" description="on the board, in no sprint" count={sprintView.unscheduled.length}>
          <ItemRowList cards={sprintView.unscheduled} slug={slug} />
        </Section>
      )}
      <ItemPeek
        item={peekItem}
        product={board.product}
        mode={board.mode}
        canManage={canManage}
        canLinkClient={isOps}
        tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
        viewer={{ id: session.user.id, name: session.user.name }}
      />
    </div>
  );
}
