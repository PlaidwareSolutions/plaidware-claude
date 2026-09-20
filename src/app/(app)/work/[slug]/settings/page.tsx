import { notFound, redirect } from "next/navigation";
import { BoardSettingsForm } from "@/modules/work/components/board-settings-form";
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
  return (
    <BoardSettingsForm
      board={{
        id: board.id,
        keyPrefix: board.keyPrefix,
        mode: board.mode,
        sprintLengthDays: board.sprintLengthDays,
        wipLimits: board.wipLimits,
        hasActiveSprint: board.activeSprint !== null,
      }}
    />
  );
}
