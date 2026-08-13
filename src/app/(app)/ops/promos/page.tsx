import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listPromos, listProductOptions, listTenantOptions } from "@/modules/promos/queries";
import { PromoManager } from "@/modules/promos/components/promo-manager";

export const metadata = { title: "Promos" };
export const dynamic = "force-dynamic";

export default async function OpsPromosPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const [promos, tenants, products] = await Promise.all([
    listPromos(),
    listTenantOptions(),
    listProductOptions(),
  ]);

  return <PromoManager promos={promos} tenants={tenants} products={products} />;
}
