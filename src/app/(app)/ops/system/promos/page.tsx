import { redirect } from "next/navigation";
import { env } from "@/env";
import { requireOpsPage } from "@/policy";
import { OPS } from "@/lib/routes";
import { listPromos, listProductOptions, listTenantOptions } from "@/modules/promos/queries";
import { PromoManager } from "@/modules/promos/components/promo-manager";

export const metadata = { title: "Promos · System" };
export const dynamic = "force-dynamic";

export default async function OpsPromosPage() {
  if (env.PROMOS_ENABLED !== "true") redirect(OPS.access);
  await requireOpsPage();

  const [promos, tenants, products] = await Promise.all([
    listPromos(),
    listTenantOptions(),
    listProductOptions(),
  ]);

  return <PromoManager promos={promos} tenants={tenants} products={products} />;
}
