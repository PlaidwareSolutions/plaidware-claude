import { notFound } from "next/navigation";
import { requireOpsPage } from "@/policy";
import { listTenantSubscriptions } from "@/modules/billing/queries";
import { listTenantProvisioning } from "@/modules/provisioning/queries";
import { tenantDeliveryHealth } from "@/modules/webhooks_out/queries";
import { OpsProvisioning } from "@/modules/provisioning/components/ops-provisioning";
import { listTenantPartnerLinks } from "@/modules/partners/queries";
import { PartnerLinkCard } from "@/modules/partners/components/partner-link-card";
import { hasOpsLevel } from "@/lib/roles";
import { loadClient, clientMetadata } from "../load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return clientMetadata(params, "Provisioning");
}

export default async function ClientProvisioningPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOpsPage("support");
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();

  const subscriptions = await listTenantSubscriptions(id);
  const [items, deliveries, links] = await Promise.all([
    listTenantProvisioning(subscriptions),
    client.partnerNames.length > 0 ? tenantDeliveryHealth(subscriptions.map((s) => s.id), id, 20) : Promise.resolve(null),
    listTenantPartnerLinks(id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PartnerLinkCard tenantId={id} links={links} canEdit={hasOpsLevel(session.user.platformRole, "admin")} />
      <OpsProvisioning tenantId={id} items={items} deliveries={deliveries} />
    </div>
  );
}
