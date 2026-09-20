import { notFound } from "next/navigation";
import { listAllTenants } from "@/modules/tenancy/queries";
import { getItem } from "@/modules/work/queries";
import { ItemDetail } from "@/modules/work/components/item/item-detail";
import { boardMetadata, loadBoard } from "../../load";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { number } = await params;
  return boardMetadata(params, `Item ${number}`);
}

export default async function ItemPage({ params }: { params: Params }) {
  const { slug, number } = await params;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) notFound();
  const { board, viewer, isOps, canManage } = await loadBoard(slug);
  if (!board) notFound();
  const [item, tenants] = await Promise.all([getItem(board.id, n, viewer), isOps ? listAllTenants() : Promise.resolve([])]);
  if (!item) notFound();
  return (
    <ItemDetail
      slug={slug}
      mode={board.mode}
      item={item}
      canManage={canManage}
      canLinkClient={isOps}
      tenants={tenants.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
