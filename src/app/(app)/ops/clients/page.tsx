import { requireOpsPage } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { OpsClientsTable } from "@/modules/tenancy/components/ops-clients-table";
import { OnboardClientWizard } from "@/modules/onboarding/components/onboard-client-wizard";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function OpsClientsPage() {
  await requireOpsPage();
  const [tenants, products] = await Promise.all([listAllTenants(), listActiveProducts()]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        description="Every customer workspace on the platform."
        actions={<OnboardClientWizard products={products} />}
      />
      <OpsClientsTable tenants={tenants} />
    </div>
  );
}
