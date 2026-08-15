/**
 * Billing v2 smoke (Stripe TEST MODE, dev server running).
 * Covers: quarterly interval pricing, tenant price overrides at checkout,
 * mid-subscription add/remove with proration, one-time add-on immediate
 * invoice, default-PM promotion, pre-due reminder dedupe, invoice.upcoming.
 *
 * Run: node --env-file=.env --import tsx scripts/smoke-billing-v2.ts
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { member, organization, user } from "../src/modules/auth/schema";
import { productComponents, products } from "../src/modules/catalog/schema";
import { invoices, subscriptionItems, subscriptions, tenantPriceOverrides } from "../src/modules/billing/schema";
import { changeSubscriptionItems, createCheckout } from "../src/modules/billing/service";
import { sendPreDueReminders } from "../src/modules/billing/ar-service";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const stripe = getStripe();
const DAY = 86_400_000;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const uid = `v2_${Date.now()}`;
  const [u] = await db.insert(user).values({
    id: uid, name: "V2 Tester", email: `${uid}@example.com`, emailVerified: true,
    firstName: "V2", lastName: "Tester", phone: "+15550005555",
    createdAt: new Date(), updatedAt: new Date(),
  }).returning();
  const [org] = await db.insert(organization).values({
    id: crypto.randomUUID(), name: "V2 Corp", slug: `v2-${Date.now()}`, status: "active", createdAt: new Date(),
  }).returning();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() });

  const fixorata = await db.query.products.findFirst({ where: eq(products.slug, "fixorata") });
  assert(fixorata, "fixorata seeded");
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, fixorata.id),
  });
  const base = comps.find((c) => c.role === "base")!;
  const onboarding = comps.find((c) => c.name.startsWith("Onboarding"))!;
  const terminal = comps.find((c) => c.name === "Extra Terminal")!;
  assert(base.kind === "recurring" && base.interval === "month", "base migrated to interval model");

  console.log("1) quarterly add-on component…");
  const [quarterly] = await db.insert(productComponents).values({
    productId: fixorata.id, kind: "recurring", interval: "month", intervalCount: 3,
    role: "addon", name: `Quarterly Deep Clean ${Date.now()}`, amountCents: 30000, sortOrder: 50,
  }).returning();

  console.log("2) tenant price override on the base ($149 → $99)…");
  await db.insert(tenantPriceOverrides).values({
    tenantId: org.id, componentId: base.id, amountCents: 9900, createdByUserId: u.id,
  });

  console.log("3) checkout: base(override) + onboarding + quarterly…");
  const co = await createCheckout({
    tenantId: org.id,
    productId: fixorata.id,
    componentIds: [quarterly.id],
    contact: { email: u.email, name: u.name },
    userId: u.id,
  });
  assert(co.mode === "payment" && co.clientSecret, "payment secret");
  // Expected first charge: onboarding 1500 + base 99 (override) + quarterly 300 = $1,899
  const pi = await stripe.paymentIntents.retrieve(co.clientSecret!.split("_secret_")[0]);
  assert(pi.amount === 150000 + 9900 + 30000, `first invoice ${pi.amount}, expected 189900`);

  const items = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, co.subscriptionId),
  });
  const baseItem = items.find((i) => i.componentId === base.id)!;
  assert(baseItem.amountCents === 9900, "override snapshotted into item");
  const qItem = items.find((i) => i.componentId === quarterly.id)!;
  assert(qItem.interval === "month" && qItem.intervalCount === 3, "quarterly interval snapshotted");

  // Verify the Stripe price really is every-3-months
  const qPrice = await stripe.prices.retrieve(qItem.stripePriceId!);
  assert(qPrice.recurring?.interval === "month" && qPrice.recurring.interval_count === 3, "stripe quarterly price");

  console.log("4) pay + activate…");
  const paid = await stripe.paymentIntents.confirm(pi.id, { payment_method: "pm_card_visa" });
  assert(paid.status === "succeeded", "paid");
  const local = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) });
  const stripeSub = await stripe.subscriptions.retrieve(local!.stripeSubscriptionId!);
  const inv = await stripe.invoices.retrieve(
    typeof stripeSub.latest_invoice === "string" ? stripeSub.latest_invoice : stripeSub.latest_invoice!.id!,
  );
  for (const [type, obj] of [["customer.subscription.updated", stripeSub], ["invoice.paid", inv]] as const) {
    const r = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: `evt_v2_${type}_${Date.now()}`, type, data: { object: obj } }),
    });
    assert(r.ok, `webhook ${type}`);
  }
  const activated = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) });
  assert(activated?.status === "active", "active after webhook");

  console.log("5) default PM promoted to customer…");
  const orgRow = await db.query.organization.findFirst({ where: eq(organization.id, org.id) });
  const customer = (await stripe.customers.retrieve(orgRow!.stripeCustomerId!)) as import("stripe").Stripe.Customer;
  assert(customer.invoice_settings?.default_payment_method, "customer default PM set");

  console.log("6) mid-sub: add recurring Extra Terminal (prorated)…");
  const add1 = await changeSubscriptionItems({
    subscriptionId: co.subscriptionId, addComponentIds: [terminal.id], actorUserId: u.id,
  });
  assert(add1.added === 1, "terminal added");
  const afterAdd = await stripe.subscriptions.retrieve(local!.stripeSubscriptionId!);
  assert(afterAdd.items.data.length === 3, `stripe items ${afterAdd.items.data.length}, expected 3 (base+quarterly+terminal)`);

  console.log("7) mid-sub: remove it (prorated credit)…");
  const termItem = (await db.query.subscriptionItems.findMany({
    where: and(eq(subscriptionItems.subscriptionId, co.subscriptionId), eq(subscriptionItems.componentId, terminal.id)),
  })).find((i) => i.status === "active")!;
  const rem = await changeSubscriptionItems({
    subscriptionId: co.subscriptionId, removeItemIds: [termItem.id], actorUserId: u.id,
  });
  assert(rem.removed === 1, "terminal removed");
  const afterRemove = await stripe.subscriptions.retrieve(local!.stripeSubscriptionId!);
  assert(afterRemove.items.data.length === 2, "stripe back to 2 items");

  console.log("8) mid-sub: one-time add-on → immediate auto-charged invoice…");
  const [oneTimeAddon] = await db.insert(productComponents).values({
    productId: fixorata.id, kind: "one_time", role: "addon",
    name: `Rush Setup ${Date.now()}`, amountCents: 25000, sortOrder: 60,
  }).returning();
  const add2 = await changeSubscriptionItems({
    subscriptionId: co.subscriptionId, addComponentIds: [oneTimeAddon.id], actorUserId: u.id,
  });
  assert(add2.added === 1, "one-time added");
  const custInvoices = await stripe.invoices.list({ customer: orgRow!.stripeCustomerId!, limit: 5 });
  const rush = custInvoices.data.find((i) => (i.amount_due === 25000));
  assert(rush, "immediate $250 invoice exists");
  assert(rush.status === "paid", `one-time add-on auto-charged (got ${rush.status})`);

  console.log("9) pre-due reminder decision + dedupe…");
  const [manualInv] = await db.insert(invoices).values({
    tenantId: org.id, kind: "manual", invoiceNumber: `SMOKE-${Date.now()}`,
    status: "open", amountDueCents: 50000, dueDate: new Date(Date.now() + 2 * DAY),
  }).returning();
  const sent1 = await sendPreDueReminders();
  const stamped = await db.query.invoices.findFirst({ where: eq(invoices.id, manualInv.id) });
  assert(sent1 >= 1 && stamped?.upcomingReminderSentAt, "pre-due reminder sent + stamped");
  const before = stamped!.upcomingReminderSentAt!.getTime();
  await sendPreDueReminders();
  const stamped2 = await db.query.invoices.findFirst({ where: eq(invoices.id, manualInv.id) });
  assert(stamped2!.upcomingReminderSentAt!.getTime() === before, "no duplicate reminder");

  console.log("10) invoice.upcoming webhook path…");
  const up = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: `evt_v2_upcoming_${Date.now()}`, type: "invoice.upcoming", data: { object: inv } }),
  });
  assert(up.ok, "invoice.upcoming handled");

  console.log("cleanup…");
  if (local?.stripeSubscriptionId) await stripe.subscriptions.cancel(local.stripeSubscriptionId).catch(() => {});
  if (orgRow?.stripeCustomerId) await stripe.customers.del(orgRow.stripeCustomerId).catch(() => {});
  // Org first: cascades subscriptions → items, freeing the component FKs.
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(productComponents).where(eq(productComponents.id, quarterly.id));
  await db.delete(productComponents).where(eq(productComponents.id, oneTimeAddon.id));
  await db.delete(user).where(eq(user.id, u.id));

  console.log("\n✅ BILLING V2 SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
