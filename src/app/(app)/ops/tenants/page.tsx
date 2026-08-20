import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { listActiveProducts } from "@/modules/catalog/queries";
import { OpsTenants } from "@/modules/tenancy/components/ops-tenants";
import { OnboardClientWizard } from "@/modules/onboarding/components/onboard-client-wizard";

export const metadata = { title: "Tenants" };
export const dynamic = "force-dynamic";

export default async function OpsTenantsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

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
