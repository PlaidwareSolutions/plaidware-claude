import { notFound } from "next/navigation";
import { getSprintReport } from "@/modules/work/queries";
import { SprintReport } from "@/modules/work/components/sprints/sprint-report";
import { boardMetadata, loadBoard } from "../../load";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  return boardMetadata(params, "Sprint");
}

export default async function SprintPage({ params }: { params: Params }) {
  const { slug, id } = await params;
  const { board, viewer } = await loadBoard(slug);
  if (!board) notFound();
  const report = await getSprintReport(id, viewer);
  if (!report || report.sprint.boardId !== board.id) notFound();
  return <SprintReport slug={slug} report={report} />;
}
