import { requireOpsPage } from "@/policy";
import { env } from "@/env";
import { listProductOptions } from "@/modules/promos/queries";
import { listAllSubscriptionsOps } from "@/modules/billing/queries";
import {
  costsByTenant,
  currentMonth,
  listHostedAppsWithCosts,
  marginByProduct,
  totalCostCents,
} from "@/modules/costs/service";
import { CostsView } from "@/modules/costs/components/costs-view";

export const metadata = { title: "Costs · System" };
export const dynamic = "force-dynamic";

const CLOSED = new Set(["canceled", "expired"]);

function recentMonths(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default async function OpsCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireOpsPage("support");
  const { month: requested } = await searchParams;
  const months = recentMonths(12);
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : currentMonth();

  const [apps, margins, byTenant, products, subs, costCents] = await Promise.all([
    listHostedAppsWithCosts(month),
    marginByProduct(month),
    costsByTenant(month),
    listProductOptions(),
    listAllSubscriptionsOps(),
    totalCostCents(month),
  ]);

  return (
    <CostsView
      month={month}
      months={months.includes(month) ? months : [month, ...months]}
      totals={{ costCents, revenueCents: margins.reduce((s, m) => s + m.revenueCents, 0) }}
      apps={apps}
      margins={margins}
      byTenant={byTenant}
      products={products}
      subscriptions={subs
        .filter((s) => !CLOSED.has(s.status))
        .map((s) => ({ id: s.id, tenantId: s.tenantId, tenantName: s.tenantName, productId: s.productId, productName: s.productName }))
        .sort((a, b) => a.tenantName.localeCompare(b.tenantName) || a.productName.localeCompare(b.productName))}
      railwayConfigured={Boolean(env.RAILWAY_API_TOKEN)}
    />
  );
}
