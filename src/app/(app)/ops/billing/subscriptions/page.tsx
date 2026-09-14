import { requireOpsPage } from "@/policy";
import { listAllSubscriptionsOps } from "@/modules/billing/queries";
import { OpsSubscriptions } from "@/modules/billing/components/ops-subscriptions";

export const metadata = { title: "Subscriptions · Billing" };
export const dynamic = "force-dynamic";

export default async function OpsSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; product?: string }>;
}) {
  await requireOpsPage();

  const [{ q, status, product }, rows] = await Promise.all([searchParams, listAllSubscriptionsOps()]);
  return (
    <OpsSubscriptions
      rows={rows}
      initialQuery={q ?? ""}
      initialStatus={status ?? "live"}
      initialProduct={product ?? "all"}
    />
  );
}
