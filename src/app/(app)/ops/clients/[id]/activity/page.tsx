import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { tenantTimeline } from "@/modules/audit/service";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { tenantDeliveryHealth } from "@/modules/webhooks_out/queries";
import { ActivityFeed } from "@/modules/audit/components/activity-feed";
import { DeliveryList } from "@/modules/webhooks_out/components/delivery-list";
import { loadClient, clientMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params, "Activity");
}

export default async function ClientActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const subscriptions = await listTenantSubscriptions(id);
  const [timeline, deliveries] = await Promise.all([
    tenantTimeline(id, 200),
    tenantDeliveryHealth(subscriptions.map((s) => s.id), id, 50),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <ActivityFeed entries={timeline} />
      {(client.hasMarketing || deliveries.total > 0) && (
        <DeliveryList deliveries={deliveries.recent} dead={deliveries.dead} />
      )}
    </div>
  );
}
