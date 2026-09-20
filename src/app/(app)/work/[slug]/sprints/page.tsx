import { notFound, redirect } from "next/navigation";
import { listSprints } from "@/modules/work/queries";
import { nextSprintWindow } from "@/modules/work/sprint-logic";
import { SprintsPanel } from "@/modules/work/components/sprints/sprints-panel";
import { WORK } from "@/lib/routes";
import { isoDay } from "@/lib/dates";
import { boardMetadata, loadBoard } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return boardMetadata(params, "Sprints");
}

export default async function SprintsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { board } = await loadBoard(slug);
  if (!board) notFound();
  if (board.mode !== "sprints") redirect(WORK.board(slug));
  const sprints = await listSprints(board.id);
  const latestEnd = sprints.reduce<string | null>((m, s) => (m === null || s.endsOn > m ? s.endsOn : m), null);
  const defaults = nextSprintWindow({ lengthDays: board.sprintLengthDays, previousEndsOn: latestEnd, today: isoDay() });
  return <SprintsPanel slug={slug} boardId={board.id} cadenceDays={board.sprintLengthDays} sprints={sprints} defaults={defaults} />;
}
