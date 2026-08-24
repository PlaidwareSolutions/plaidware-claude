import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listDeadDeliveries, listRecentDeliveries } from "@/modules/webhooks_out/queries";
import { OpsWebhooksView } from "@/modules/webhooks_out/components/ops-webhooks-view";

export const metadata = { title: "Outbound Webhooks" };
export const dynamic = "force-dynamic";

export default async function OpsWebhooksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const [dead, recent] = await Promise.all([listDeadDeliveries(), listRecentDeliveries(50)]);
  return <OpsWebhooksView dead={dead} recent={recent} />;
}
