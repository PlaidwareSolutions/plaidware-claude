import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { listOpenSetupInvites } from "@/modules/onboarding/queries";
import { OpsClientsTable } from "@/modules/tenancy/components/ops-clients-table";
import { SetupLinksCard } from "@/modules/onboarding/components/setup-links-card";
import { OPS } from "@/lib/routes";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function OpsClientsPage() {
  await requireOpsPage();
  const [tenants, openInvites] = await Promise.all([listAllTenants(), listOpenSetupInvites()]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Clients"
        description="Every customer workspace on the platform."
        actions={
          <Button asChild className="gap-2">
            <Link href={OPS.clientNew}>
              <UserPlus className="size-4" /> Onboard client
            </Link>
          </Button>
        }
      />
      <OpsClientsTable tenants={tenants} />
      {openInvites.length > 0 && <SetupLinksCard invites={openInvites} showTenant compact />}
    </div>
  );
}
