import { notFound, redirect } from "next/navigation";
import { BoardSettingsForm } from "@/modules/work/components/board-settings-form";
import { listWorkAssignees } from "@/modules/work/queries";
import { WORK } from "@/lib/routes";
import { boardMetadata, loadBoard } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return boardMetadata(params, "Settings");
}

export default async function BoardSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { board, canManage } = await loadBoard(slug);
  if (!board) notFound();
  if (!canManage) redirect(WORK.board(slug));
  const people = await listWorkAssignees();
  return (
    <BoardSettingsForm
      people={people}
      board={{
        id: board.id,
        keyPrefix: board.keyPrefix,
        mode: board.mode,
        sprintLengthDays: board.sprintLengthDays,
        wipLimits: board.wipLimits,
        reportAssigneeUserId: board.reportAssigneeUserId,
        hasActiveSprint: board.activeSprint !== null,
      }}
    />
  );
}
