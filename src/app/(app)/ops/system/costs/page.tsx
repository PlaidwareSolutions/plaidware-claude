import { requireOpsPage } from "@/policy";
import { listProductOptions } from "@/modules/promos/queries";
import { currentMonth, listHostedAppsWithCosts, marginByProduct } from "@/modules/costs/service";
import { CostsView } from "@/modules/costs/components/costs-view";

export const metadata = { title: "Costs · System" };
export const dynamic = "force-dynamic";

export default async function OpsCostsPage() {
  await requireOpsPage();

  const month = currentMonth();
  const [apps, margins, products] = await Promise.all([
    listHostedAppsWithCosts(month),
    marginByProduct(month),
    listProductOptions(),
  ]);

  return <CostsView month={month} apps={apps} margins={margins} products={products} />;
}
