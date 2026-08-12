import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listAllTenants } from "@/modules/tenancy/queries";
import { OpsTenants } from "@/modules/tenancy/components/ops-tenants";

export const metadata = { title: "Tenants" };

export default async function OpsTenantsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const tenants = await listAllTenants();
  return <OpsTenants tenants={tenants} />;
}
