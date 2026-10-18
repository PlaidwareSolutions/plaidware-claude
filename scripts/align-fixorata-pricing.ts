/**
 * Align the `fixorata` catalog product with fixorata.com's advertised pricing
 * (2026-10-17): 30-day free trial, then $35/month per store; no onboarding
 * fee, no per-terminal add-on. The catalog seed never reprices existing rows,
 * so this one-off brings an existing database in line. Idempotent; dry run
 * unless --apply.
 *
 * Mirrors the ops price edit: a changed amount clears stripePriceId so the
 * next checkout mints a fresh Stripe Price; existing subscriptions keep the
 * prices they were sold at (reported below, never changed here).
 *
 * Run: node --env-file=.env --import tsx scripts/align-fixorata-pricing.ts [--apply]
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "../src/modules/billing/mappers";
import { subscriptionItems, subscriptions } from "../src/modules/billing/schema";
import { productComponents, products } from "../src/modules/catalog/schema";

const BASE_CENTS = 3500;
const TRIAL_DAYS = 30;
const RETIRE = ["Onboarding + POS Integration", "Extra Terminal"];

async function main() {
  const apply = process.argv.includes("--apply");
  const product = await db.query.products.findFirst({ where: eq(products.slug, "fixorata") });
  if (!product) throw new Error('No "fixorata" product in this database');
  const comps = await db.query.productComponents.findMany({ where: eq(productComponents.productId, product.id) });
  const base = comps.find((c) => c.role === "base");
  if (!base) throw new Error("fixorata has no base component");

  const plan: string[] = [];
  if (product.trialDays !== TRIAL_DAYS) plan.push(`trialDays ${product.trialDays ?? "none"} → ${TRIAL_DAYS}`);
  if (base.amountCents !== BASE_CENTS || base.interval !== "month" || base.intervalCount !== 1) {
    plan.push(`"${base.name}" ${base.amountCents}¢/${base.interval} → ${BASE_CENTS}¢/month (new Stripe price on next checkout)`);
  }
  const retire = comps.filter((c) => RETIRE.includes(c.name) && (c.isActive || c.isRequired));
  for (const c of retire) plan.push(`retire "${c.name}" (${c.amountCents}¢, ${c.kind}) — inactive, not required`);

  const live = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId, status: subscriptions.status })
    .from(subscriptions)
    .where(and(eq(subscriptions.productId, product.id), inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES])));
  const items = live.length
    ? await db.query.subscriptionItems.findMany({ where: inArray(subscriptionItems.subscriptionId, live.map((s) => s.id)) })
    : [];

  console.log(`fixorata (${product.id}) — ${apply ? "APPLY" : "dry run"}`);
  console.log(plan.length ? plan.map((l) => `  • ${l}`).join("\n") : "  already aligned");
  console.log(`live subscriptions keeping their sold prices: ${live.length}`);
  for (const s of live) {
    const own = items.filter((i) => i.subscriptionId === s.id && i.status !== "canceled");
    console.log(`  - ${s.id} tenant=${s.tenantId} ${s.status}: ${own.map((i) => `${i.name} ${i.amountCents}¢×${i.quantity}`).join(", ")}`);
  }
  if (!apply || plan.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.update(products).set({ trialDays: TRIAL_DAYS }).where(eq(products.id, product.id));
    if (base.amountCents !== BASE_CENTS || base.interval !== "month" || base.intervalCount !== 1) {
      await tx
        .update(productComponents)
        .set({ amountCents: BASE_CENTS, kind: "recurring", interval: "month", intervalCount: 1, stripePriceId: null })
        .where(eq(productComponents.id, base.id));
    }
    for (const c of retire) {
      await tx.update(productComponents).set({ isActive: false, isRequired: false }).where(eq(productComponents.id, c.id));
    }
  });
  console.log("applied.");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    await pool.end();
    process.exit(1);
  });
