/**
 * Promo engine smoke (Stripe TEST MODE, dev server running).
 * Covers: catalog coupon sync, manual code checkout, real payment,
 * savings-ledger reconciliation from a real Stripe invoice, completion,
 * and redemption counting.
 *
 * Run: node --env-file=.env --import tsx scripts/smoke-promo.ts
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { member, organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { subscriptions } from "../src/modules/billing/schema";
import { promoCodes, promoRedemptions } from "../src/modules/promos/schema";
import { createCheckout } from "../src/modules/billing/service";
import { syncPromoToStripe } from "../src/modules/promos/service";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const stripe = getStripe();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const uid = `promo_${Date.now()}`;
  const [u] = await db
    .insert(user)
    .values({
      id: uid, name: "Promo Tester", email: `${uid}@example.com`, emailVerified: true,
      firstName: "Promo", lastName: "Tester", phone: "+15550002222",
      createdAt: new Date(), updatedAt: new Date(),
    })
    .returning();
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: "Promo Corp", slug: `promo-${Date.now()}`, status: "active", createdAt: new Date() })
    .returning();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() });

  const code = `SMOKE25_${Date.now().toString(36).toUpperCase()}`;
  const [promo] = await db
    .insert(promoCodes)
    .values({ code, kind: "percent_off", percentOff: 25, duration: "once", isPublic: true })
    .returning();

  console.log("1) syncing promo to Stripe…");
  await syncPromoToStripe(promo.id);
  const synced = await db.query.promoCodes.findFirst({ where: eq(promoCodes.id, promo.id) });
  assert(synced?.stripeCouponId && synced.stripePromotionCodeId, "coupon + promotion code created");

  console.log("2) checkout with the code (fixorata: $1,500 + $149/mo)…");
  const fixorata = await db.query.products.findFirst({ where: eq(products.slug, "fixorata") });
  assert(fixorata, "fixorata seeded");
  const co = await createCheckout({
    tenantId: org.id,
    productId: fixorata.id,
    componentIds: [],
    contact: { email: u.email, name: u.name },
    promoCode: code,
    userId: u.id,
  });
  assert(co.appliedPromo?.code === code, "promo attached to checkout");
  // 25% of $1,649 = $412.25
  assert(co.appliedPromo.firstInvoiceSavingsCents === 41225, `expected 41225, got ${co.appliedPromo.firstInvoiceSavingsCents}`);

  const redemption0 = await db.query.promoRedemptions.findFirst({
    where: eq(promoRedemptions.subscriptionId, co.subscriptionId),
  });
  assert(redemption0?.source === "manual" && redemption0.status === "active", "redemption recorded");

  console.log("3) paying the discounted invoice…");
  const pi = await stripe.paymentIntents.confirm(co.clientSecret!.split("_secret_")[0], {
    payment_method: "pm_card_visa",
  });
  assert(pi.status === "succeeded", `payment ${pi.status}`);
  // Stripe charged the discounted amount
  assert(pi.amount === 164900 - 41225, `charged ${pi.amount}, expected ${164900 - 41225}`);

  console.log("4) reconciling savings from the real invoice via webhook…");
  const local = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) });
  const stripeSub = await stripe.subscriptions.retrieve(local!.stripeSubscriptionId!);
  const inv = await stripe.invoices.retrieve(
    typeof stripeSub.latest_invoice === "string" ? stripeSub.latest_invoice : stripeSub.latest_invoice!.id!,
  );
  const res = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: `evt_promo_${Date.now()}`, type: "invoice.paid", data: { object: inv } }),
  });
  assert(res.ok, `webhook ${res.status}`);

  const redemption1 = await db.query.promoRedemptions.findFirst({
    where: eq(promoRedemptions.subscriptionId, co.subscriptionId),
  });
  assert(redemption1?.savingsCents === 41225, `ledger savings ${redemption1?.savingsCents}, expected 41225`);
  assert(redemption1.invoicesApplied === 1, "one invoice applied");
  assert(redemption1.status === "completed", `once-promo completed (got ${redemption1.status})`);
  const promoAfter = await db.query.promoCodes.findFirst({ where: eq(promoCodes.id, promo.id) });
  assert(promoAfter?.timesRedeemed === 1, "timesRedeemed incremented");

  console.log("cleanup…");
  if (local?.stripeSubscriptionId) await stripe.subscriptions.cancel(local.stripeSubscriptionId).catch(() => {});
  const orgRow = await db.query.organization.findFirst({ where: eq(organization.id, org.id) });
  if (orgRow?.stripeCustomerId) await stripe.customers.del(orgRow.stripeCustomerId).catch(() => {});
  if (synced.stripePromotionCodeId) await stripe.promotionCodes.update(synced.stripePromotionCodeId, { active: false }).catch(() => {});
  if (synced.stripeCouponId) await stripe.coupons.del(synced.stripeCouponId).catch(() => {});
  await db.delete(promoCodes).where(eq(promoCodes.id, promo.id));
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, u.id));

  console.log("\n✅ PROMO ENGINE SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
