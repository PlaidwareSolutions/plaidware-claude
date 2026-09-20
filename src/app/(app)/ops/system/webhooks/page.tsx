import { requireOpsPage } from "@/policy";
import { listDeadDeliveries, listRecentDeliveries } from "@/modules/webhooks_out/queries";
import { OpsWebhooksView } from "@/modules/webhooks_out/components/ops-webhooks-view";

export const metadata = { title: "Webhooks · System" };
export const dynamic = "force-dynamic";

export default async function OpsWebhooksPage() {
  await requireOpsPage("support");

  const [dead, recent] = await Promise.all([listDeadDeliveries(), listRecentDeliveries(50)]);
  return <OpsWebhooksView dead={dead} recent={recent} />;
}
