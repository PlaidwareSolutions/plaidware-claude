import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { getBoardView } from "@/modules/work/queries";
import { parseBoardFilters } from "@/modules/work/contracts";
import { KanbanBoard } from "@/modules/work/components/board/kanban-board";
import { BoardFilters } from "@/modules/work/components/board/board-filters";
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

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { board, viewer } = await loadBoard(slug);
  if (!board) notFound();
  const filters = parseBoardFilters(await searchParams);
  const view = await getBoardView(board.id, viewer, {
    sprint: board.mode === "sprints" ? (filters.sprint ?? "active") : undefined,
    filters,
  });
  if (!view) notFound();
  const noSprint = board.mode === "sprints" && !view.sprint;

  return (
    <div className="group flex flex-col gap-4">
      <BoardFilters base={WORK.board(slug)} filters={view.filters} assignees={view.assignees} labels={view.labels} />
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
      ) : (
        <KanbanBoard slug={slug} columns={view.columns} doneCaption={board.mode === "sprints" ? "this sprint" : "last 14 days"} />
      )}
      {view.unscheduled.length > 0 && (
        <Section title="Unscheduled" description="on the board, in no sprint" count={view.unscheduled.length}>
          <ItemRowList cards={view.unscheduled} slug={slug} />
        </Section>
      )}
    </div>
  );
}
