import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { products } from "../catalog/schema";
import { invoices, subscriptions } from "../billing/schema";
import { appCostSamples, hostedApps, productHostedApps } from "./schema";

/** Railway usage-based pricing (published rates, editable in one place). */
const RATES = {
  CPU_USAGE: 0.000463, // $/vCPU-minute
  MEMORY_USAGE_GB: 0.000231, // $/GB-minute
  NETWORK_TX_GB: 0.05, // $/GB egress
} as const;

export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function railwayGql(query: string, variables: Record<string, unknown>) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RAILWAY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const out = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
  if (out.errors?.length) throw new Error(out.errors[0].message);
  return out.data as {
    usage: { value: number; measurement: string; tags: { serviceId: string | null } }[];
  };
}

/** Pull this month's per-service usage from Railway and store cost samples. */
export async function syncRailwayCosts(month = currentMonth()): Promise<{ apps: number; totalCents: number }> {
  if (!env.RAILWAY_API_TOKEN) throw new Error("RAILWAY_API_TOKEN not configured");
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 1)).toISOString();

  const apps = await db.query.hostedApps.findMany({ where: eq(hostedApps.provider, "railway") });
  if (apps.length === 0) return { apps: 0, totalCents: 0 };
  const byRef = new Map(apps.map((a) => [a.externalRef, a]));

  const data = await railwayGql(
    `query($s: DateTime!, $e: DateTime!) {
       usage(measurements: [CPU_USAGE, MEMORY_USAGE_GB, NETWORK_TX_GB],
             groupBy: SERVICE_ID, startDate: $s, endDate: $e) {
         value measurement tags { serviceId }
       }
     }`,
    { s: start, e: end },
  );

  const perService = new Map<string, Record<string, number>>();
  for (const row of data.usage) {
    const sid = row.tags.serviceId;
    if (!sid || !byRef.has(sid)) continue;
    const acc = perService.get(sid) ?? {};
    acc[row.measurement] = (acc[row.measurement] ?? 0) + row.value;
    perService.set(sid, acc);
  }

  let totalCents = 0;
  let count = 0;
  for (const [sid, usage] of perService) {
    const app = byRef.get(sid)!;
    const dollars = Object.entries(usage).reduce(
      (s, [k, v]) => s + (RATES[k as keyof typeof RATES] ?? 0) * v,
      0,
    );
    const costCents = Math.round(dollars * 100);
    totalCents += costCents;
    count++;
    await db
      .insert(appCostSamples)
      .values({ hostedAppId: app.id, month, costCents, source: "railway_api", breakdown: usage })
      .onConflictDoUpdate({
        target: [appCostSamples.hostedAppId, appCostSamples.month, appCostSamples.source],
        set: { costCents, breakdown: usage, createdAt: new Date() },
      });
  }
  return { apps: count, totalCents };
}

/** Manual sample overrides the API-derived one for the same app+month. */
export async function appMonthlyCostCents(hostedAppId: string, month: string): Promise<number | null> {
  const samples = await db.query.appCostSamples.findMany({
    where: and(eq(appCostSamples.hostedAppId, hostedAppId), eq(appCostSamples.month, month)),
  });
  const manual = samples.find((s) => s.source === "manual");
  return (manual ?? samples[0])?.costCents ?? null;
}

export type ProductMargin = {
  productId: string;
  productName: string;
  revenueCents: number;
  costCents: number | null;
  marginPct: number | null;
};

/** Margin per product for a month: paid invoices − attributed app costs (PRD §4.11). */
export async function marginByProduct(month: string): Promise<ProductMargin[]> {
  const [allProducts, links] = await Promise.all([
    db.query.products.findMany({ where: eq(products.isActive, true), orderBy: [products.sortOrder] }),
    db.query.productHostedApps.findMany({ where: isNull(productHostedApps.subscriptionId) }),
  ]);
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  const subs = await db.query.subscriptions.findMany({ columns: { id: true, productId: true } });
  const subProduct = new Map(subs.map((s) => [s.id, s.productId]));
  const paid = await db.query.invoices.findMany({ where: eq(invoices.status, "paid") });

  const out: ProductMargin[] = [];
  for (const p of allProducts) {
    const revenueCents = paid
      .filter(
        (i) =>
          i.paidAt && i.paidAt >= start && i.paidAt < end &&
          i.subscriptionId && subProduct.get(i.subscriptionId) === p.id,
      )
      .reduce((s, i) => s + i.amountDueCents, 0);
    const appIds = links.filter((l) => l.productId === p.id).map((l) => l.hostedAppId);
    let costCents: number | null = null;
    if (appIds.length) {
      const costs = await Promise.all(appIds.map((a) => appMonthlyCostCents(a, month)));
      const known = costs.filter((c): c is number => c != null);
      costCents = known.length ? known.reduce((s, c) => s + c, 0) : null;
    }
    out.push({
      productId: p.id,
      productName: p.name,
      revenueCents,
      costCents,
      marginPct:
        costCents != null && revenueCents > 0
          ? Math.round(((revenueCents - costCents) / revenueCents) * 100)
          : null,
    });
  }
  return out;
}

export async function listHostedAppsWithCosts(month: string) {
  const apps = await db.query.hostedApps.findMany({ orderBy: [hostedApps.label] });
  if (apps.length === 0) return [];
  const [samples, links, prods] = await Promise.all([
    db.query.appCostSamples.findMany({
      where: and(inArray(appCostSamples.hostedAppId, apps.map((a) => a.id)), eq(appCostSamples.month, month)),
    }),
    db.query.productHostedApps.findMany(),
    db.query.products.findMany({ columns: { id: true, name: true } }),
  ]);
  const pname = new Map(prods.map((p) => [p.id, p.name]));
  return apps.map((a) => {
    const mine = samples.filter((s) => s.hostedAppId === a.id);
    const manual = mine.find((s) => s.source === "manual");
    return {
      id: a.id,
      provider: a.provider,
      externalRef: a.externalRef,
      label: a.label,
      costCents: (manual ?? mine[0])?.costCents ?? null,
      costSource: (manual ?? mine[0])?.source ?? null,
      products: links
        .filter((l) => l.hostedAppId === a.id && !l.subscriptionId)
        .map((l) => pname.get(l.productId) ?? "?"),
    };
  });
}
