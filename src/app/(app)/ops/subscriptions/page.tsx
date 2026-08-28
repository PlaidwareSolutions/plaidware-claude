import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listAllSubscriptionsOps } from "@/modules/billing/queries";
import { OpsSubscriptions } from "@/modules/billing/components/ops-subscriptions";

export const metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

export default async function OpsSubscriptionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const rows = await listAllSubscriptionsOps();
  return <OpsSubscriptions rows={rows} />;
}
