import { notFound } from "next/navigation";
import { getBacklogView, listSprints } from "@/modules/work/queries";
import { parseBoardFilters } from "@/modules/work/contracts";
import { BacklogList } from "@/modules/work/components/backlog/backlog-list";
import { BoardFilters } from "@/modules/work/components/board/board-filters";
import { WORK } from "@/lib/routes";
import { boardMetadata, loadBoard } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return boardMetadata(params, "Backlog");
}

export default async function BacklogPage({
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
  const [view, sprints] = await Promise.all([getBacklogView(board.id, viewer, filters), board.mode === "sprints" ? listSprints(board.id) : Promise.resolve([])]);
  if (!view) notFound();
  const plannable = sprints.filter((s) => s.status !== "completed").map((s) => ({ id: s.id, name: s.name, status: s.status }));

  return (
    <div className="group flex flex-col gap-4">
      <BoardFilters base={WORK.backlog(slug)} filters={view.filters} assignees={view.assignees} labels={view.labels} />
      <div className="transition-opacity group-has-data-pending:opacity-50">
        <BacklogList slug={slug} boardId={board.id} mode={board.mode} view={view} sprints={plannable} />
      </div>
    </div>
  );
}
