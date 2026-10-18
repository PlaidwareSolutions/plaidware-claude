import { requireOpsPage } from "@/policy";
import { hasOpsLevel } from "@/lib/roles";
import { listPartnerAppsOps } from "@/modules/partners/queries";
import { PartnersManager } from "@/modules/partners/components/partners-manager";

export const metadata = { title: "Partners · System" };
export const dynamic = "force-dynamic";

export default async function OpsPartnersPage() {
  const session = await requireOpsPage("support");
  return <PartnersManager apps={await listPartnerAppsOps()} canEdit={hasOpsLevel(session.user.platformRole, "admin")} />;
}
