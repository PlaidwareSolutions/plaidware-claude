import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { listTenantProvisioning } from "@/modules/provisioning/queries";
import { tenantDeliveryHealth } from "@/modules/webhooks_out/queries";
import { OpsProvisioning } from "@/modules/provisioning/components/ops-provisioning";
import { loadClient, clientMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params, "Provisioning");
}

export default async function ClientProvisioningPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage();
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const subscriptions = await listTenantSubscriptions(id);
  const [items, deliveries] = await Promise.all([
    listTenantProvisioning(subscriptions),
    client.hasMarketing ? tenantDeliveryHealth(subscriptions.map((s) => s.id), id, 20) : Promise.resolve(null),
  ]);

  return <OpsProvisioning tenantId={id} items={items} deliveries={deliveries} />;
}
