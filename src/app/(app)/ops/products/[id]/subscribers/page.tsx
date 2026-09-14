import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { listAllSubscriptionsOps } from "@/modules/billing/queries";
import { OpsSubscriptions } from "@/modules/billing/components/ops-subscriptions";
import { loadProduct, productMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return productMetadata(params, "Subscribers");
}

export default async function ProductSubscribersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireOpsPage();
  const [{ id }, { status, q }] = await Promise.all([params, searchParams]);
  const data = await loadProduct(id);
  if (!data) notFound();
  const rows = (await listAllSubscriptionsOps()).filter((r) => r.productId === id);
  return (
    <OpsSubscriptions
      rows={rows}
      fixedProductSlug={data.product.slug}
      initialStatus={status ?? "live"}
      initialQuery={q ?? ""}
    />
  );
}
