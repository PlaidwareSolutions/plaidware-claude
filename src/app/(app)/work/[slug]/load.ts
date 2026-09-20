import { cache } from "react";
import { isOps, isOpsAdmin, requireWorkPage, workViewer } from "@/policy";
import { getBoardBySlug } from "@/modules/work/queries";

/**
 * One guarded read shared by the board layout, every tab page and
 * generateMetadata. requireWorkPage() lives inside so a page stays guarded
 * on soft navigation (layouts don't re-run).
 */
export const loadBoard = cache(async (slug: string) => {
  const session = await requireWorkPage();
  const board = await getBoardBySlug(slug);
  return {
    session,
    viewer: workViewer(session),
    isOps: isOps(session),
    canManage: isOpsAdmin(session),
    board,
  };
});

export async function boardMetadata(params: Promise<{ slug: string }>, tab?: string) {
  const { slug } = await params;
  const { board } = await loadBoard(slug);
  const name = board?.product.name ?? "Board";
  return { title: tab ? `${name} · ${tab}` : `${name} · Work` };
}
