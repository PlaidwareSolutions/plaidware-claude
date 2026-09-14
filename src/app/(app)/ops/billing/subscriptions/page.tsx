import { requireOpsPage } from "@/policy";
import { listAllSubscriptionsOps } from "@/modules/billing/queries";
import { OpsSubscriptions } from "@/modules/billing/components/ops-subscriptions";

export const metadata = { title: "Subscriptions · Billing" };
export const dynamic = "force-dynamic";

export default async function OpsSubscriptionsPage() {
  await requireOpsPage();

  const rows = await listAllSubscriptionsOps();
  return <OpsSubscriptions rows={rows} />;
}
