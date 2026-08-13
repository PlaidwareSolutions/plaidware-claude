import { redirect } from "next/navigation";
import { getSession, isOps } from "@/policy";
import { listProductOptions } from "@/modules/promos/queries";
import { currentMonth, listHostedAppsWithCosts, marginByProduct } from "@/modules/costs/service";
import { CostsView } from "@/modules/costs/components/costs-view";

export const metadata = { title: "Hosting Costs" };
export const dynamic = "force-dynamic";

export default async function OpsCostsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOps(session)) redirect("/dashboard");

  const month = currentMonth();
  const [apps, margins, products] = await Promise.all([
    listHostedAppsWithCosts(month),
    marginByProduct(month),
    listProductOptions(),
  ]);

  return <CostsView month={month} apps={apps} margins={margins} products={products} />;
}
