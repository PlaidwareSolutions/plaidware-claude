import { requireOpsPage } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { OpsTenants } from "@/modules/tenancy/components/ops-tenants";
import { OnboardClientWizard } from "@/modules/onboarding/components/onboard-client-wizard";

export const metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

export default async function OpsTenantsPage() {
  await requireOpsPage();

  const [tenants, products] = await Promise.all([listAllTenants(), listActiveProducts()]);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex justify-end">
        <OnboardClientWizard products={products} />
      </div>
      <OpsTenants tenants={tenants} />
    </div>
  );
}
