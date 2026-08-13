/**
 * Money-path smoke test (Stripe TEST MODE, local dev server must be running).
 * Exercises: checkout (mixed one-time + recurring), payment confirmation,
 * webhook mirroring with real Stripe payloads, trial checkout, the
 * one-live-subscription guard, and cleanup.
 *
 * Run: node --env-file=.env --import tsx scripts/smoke-checkout.ts
 */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { member, organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { invoices, subscriptionItems, subscriptions } from "../src/modules/billing/schema";
import { createCheckout } from "../src/modules/billing/service";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const stripe = getStripe();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function postWebhookFixture(type: string, object: unknown) {
  const res = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: `evt_smoke_${Math.random().toString(36).slice(2)}`,
      type,
      data: { object },
    }),
  });
  assert(res.ok, `webhook ${type} returned ${res.status}`);
}

async function main() {
  // ---- fixture user + tenant ----------------------------------------------
  const uid = `smoke_${Date.now()}`;
  const [u] = await db
    .insert(user)
    .values({
      id: uid,
      name: "Smoke Tester",
      email: `${uid}@example.com`,
      emailVerified: true,
      firstName: "Smoke",
      lastName: "Tester",
      phone: "+15550001111",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: "Smoke Corp", slug: `smoke-${Date.now()}`, status: "active", createdAt: new Date() })
    .returning();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() });

  const buildorata = await db.query.products.findFirst({ where: eq(products.slug, "buildorata") });
  const drivorata = await db.query.products.findFirst({ where: eq(products.slug, "drivorata") });
  assert(buildorata && drivorata, "seeded products present");

  // ---- 1. standard purchase: one-time + monthly ---------------------------
  console.log("1) checkout buildorata (required: $2,500 one-time + $199/mo)…");
  const co = await createCheckout({
    tenantId: org.id,
    productId: buildorata.id,
    componentIds: [],
    contact: { email: u.email, name: u.name },
  });
  assert(co.mode === "payment" && co.clientSecret, "payment client secret returned");

  const piId = co.clientSecret!.split("_secret_")[0];
  console.log("   confirming payment with test card…");
  const pi = await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });
  assert(pi.status === "succeeded", `payment intent ${pi.status}`);

  // ---- 2. one-live-subscription guard -------------------------------------
  console.log("2) duplicate checkout must be rejected…");
  let dupBlocked = false;
  try {
    await createCheckout({ tenantId: org.id, productId: buildorata.id, componentIds: [], contact: { email: u.email, name: u.name } });
  } catch (e) {
    dupBlocked = e instanceof Error && /already have an active/.test(e.message);
  }
  assert(dupBlocked, "duplicate live subscription blocked");

  // ---- 3. webhook mirror with REAL Stripe payloads ------------------------
  console.log("3) replaying real Stripe objects through the webhook…");
  const local = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) });
  assert(local?.stripeSubscriptionId, "local sub has stripe id");
  const stripeSub = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);
  const inv = await stripe.invoices.retrieve(
    typeof stripeSub.latest_invoice === "string" ? stripeSub.latest_invoice : stripeSub.latest_invoice!.id!,
  );
  await postWebhookFixture("customer.subscription.updated", stripeSub);
  await postWebhookFixture("invoice.paid", inv);

  const after = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) });
  assert(after?.status === "active", `subscription active (got ${after?.status})`);
  const items = await db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, co.subscriptionId) });
  assert(items.find((i) => i.kind === "one_time")?.status === "paid", "one-time item flipped to paid");
  assert(items.find((i) => i.kind === "recurring_monthly")?.status === "active", "recurring item active");
  const mirrored = await db.query.invoices.findFirst({ where: eq(invoices.stripeInvoiceId, inv.id!) });
  assert(mirrored?.status === "paid", "invoice mirrored as paid");
  assert(mirrored.amountDueCents === 269900, `first invoice $2,699 (got ${mirrored.amountDueCents})`);

  // ---- 4. trial checkout ---------------------------------------------------
  console.log("4) trial checkout (drivorata, 14 trial days)…");
  await db.update(products).set({ trialDays: 14 }).where(eq(products.id, drivorata.id));
  const trial = await createCheckout({
    tenantId: org.id,
    productId: drivorata.id,
    componentIds: [],
    contact: { email: u.email, name: u.name },
  });
  // Required one-time onboarding fee is still due today (PRD §4.4), so the
  // subscription starts `incomplete` and flips to `trialing` once it's paid.
  assert(trial.mode === "payment" && trial.clientSecret, "one-time fee still collected during trial");
  let trialLocal = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, trial.subscriptionId) });
  assert(trialLocal?.trialEndsAt && trialLocal.trialEndsAt > new Date(), "trialEndsAt in future");
  const trialPi = await stripe.paymentIntents.confirm(trial.clientSecret!.split("_secret_")[0], { payment_method: "pm_card_visa" });
  assert(trialPi.status === "succeeded", `trial one-time payment ${trialPi.status}`);
  const trialStripeSub = await stripe.subscriptions.retrieve(trialLocal.stripeSubscriptionId!);
  assert(trialStripeSub.status === "trialing", `stripe sub trialing after fee paid (got ${trialStripeSub.status})`);
  await postWebhookFixture("customer.subscription.updated", trialStripeSub);
  trialLocal = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, trial.subscriptionId) });
  assert(trialLocal?.status === "trialing", `local trialing after webhook (got ${trialLocal?.status})`);
  await db.update(products).set({ trialDays: null }).where(eq(products.id, drivorata.id));

  // ---- 5. webhook dedupe ---------------------------------------------------
  console.log("5) duplicate event id is skipped…");
  const evtId = `evt_smoke_dedupe_${Date.now()}`;
  const dup1 = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: evtId, type: "invoice.paid", data: { object: inv } }),
  }).then((r) => r.json());
  const dup2 = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: evtId, type: "invoice.paid", data: { object: inv } }),
  }).then((r) => r.json());
  assert(!dup1.duplicate && dup2.duplicate === true, "second delivery flagged duplicate");

  // ---- cleanup -------------------------------------------------------------
  console.log("cleanup…");
  for (const sid of [local.stripeSubscriptionId, (await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, trial.subscriptionId) }))?.stripeSubscriptionId]) {
    if (sid) await stripe.subscriptions.cancel(sid).catch(() => {});
  }
  const orgRow = await db.query.organization.findFirst({ where: eq(organization.id, org.id) });
  if (orgRow?.stripeCustomerId) await stripe.customers.del(orgRow.stripeCustomerId).catch(() => {});
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, u.id));

  console.log("\n✅ MONEY PATH SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
