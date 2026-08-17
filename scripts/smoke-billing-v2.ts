/**
 * Billing v2 smoke (Stripe TEST MODE, dev server running).
 * Covers: per-tenant override at checkout, quarterly interval price, mid-sub
 * recurring add (prorated) + remove (credit), one-time add-on charged now,
 * manual invoice collect=auto path.
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
import { createManualInvoice } from "../src/modules/billing/ar-service";

const stripe = getStripe();
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

  const custom = await db.query.products.findFirst({ where: eq(products.slug, "custom-application") });
  assert(custom, "custom-application seeded");
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, custom.id),
  });
  const webHosting = comps.find((c) => c.name === "Website Hosting")!;
  const appHosting = comps.find((c) => c.name === "Application Hosting")!;
  const domain = comps.find((c) => c.name === "Domain Renewal")!;
  const build = comps.find((c) => c.name === "Website Application Build")!;
  assert(webHosting.role === "base", "Website Hosting is the base");

  console.log("0) quarterly interval price mints correctly on Stripe…");
  const [quarterly] = await db.insert(productComponents).values({
    productId: custom.id, kind: "recurring", interval: "month", intervalCount: 3,
    role: "addon", name: `Quarterly Tune-up ${Date.now()}`, amountCents: 30000, sortOrder: 98,
  }).returning();

  console.log("1) per-tenant override: app hosting $45 → $40 for this tenant…");
  await db.insert(tenantPriceOverrides).values({
    tenantId: org.id, componentId: appHosting.id, amountCents: 4000, createdByUserId: u.id,
  });

  console.log("2) checkout: base + app hosting (override) + domain yearly…");
  const co = await createCheckout({
    tenantId: org.id, productId: custom.id,
    componentIds: [domain.id],
    contact: { email: u.email, name: u.name }, userId: u.id,
  });
  assert(co.mode === "payment" && co.clientSecret, "payment mode");
  const pi = await stripe.paymentIntents.confirm(co.clientSecret!.split("_secret_")[0], { payment_method: "pm_card_visa" });
  // $35 base + $40 override + $22 domain = $97.00
  assert(pi.amount === 9700, `first charge ${pi.amount}, expected 9700 (override honored)`);

  const items = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, co.subscriptionId),
  });
  const appItem = items.find((i) => i.componentId === appHosting.id);
  assert(appItem?.amountCents === 4000, "override snapshotted on item");
  const domItem = items.find((i) => i.componentId === domain.id);
  assert(domItem?.interval === "year", "yearly interval snapshotted");

  // Sync local status via Stripe (webhookless in this script)
  const localSub = (await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, co.subscriptionId) }))!;
  await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.id, co.subscriptionId));

  console.log("3) mid-sub: add quarterly add-on (prorated) …");
  const r1 = await changeSubscriptionItems({
    subscriptionId: co.subscriptionId, addComponentIds: [quarterly.id], actorUserId: u.id,
  });
  assert(r1.added === 1, "one recurring add-on added");
  const stripeSub = await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId!);
  assert(stripeSub.items.data.length === 4, `stripe has 4 items (got ${stripeSub.items.data.length})`);

  console.log("4) mid-sub: remove it (proration credit) …");
  const addedItem = (await db.query.subscriptionItems.findMany({
    where: and(eq(subscriptionItems.subscriptionId, co.subscriptionId), eq(subscriptionItems.componentId, quarterly.id)),
  })).find((i) => i.status === "active")!;
  const r2 = await changeSubscriptionItems({
    subscriptionId: co.subscriptionId, removeItemIds: [addedItem.id], actorUserId: u.id,
  });
  assert(r2.removed === 1, "add-on removed");
  const after = await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId!);
  assert(after.items.data.length === 3, "stripe back to 3 items");

  console.log("5) mid-sub: one-time add-on charged immediately…");
  const r3 = await changeSubscriptionItems({
    subscriptionId: co.subscriptionId, addComponentIds: [build.id], actorUserId: u.id,
  });
  assert(r3.added === 1, "one-time add recorded");
  const oneTimeInvoices = await db.query.invoices.findMany({ where: eq(invoices.tenantId, org.id) });
  assert(oneTimeInvoices.some((i) => i.amountDueCents === 50000), "one-time $500 invoice exists");

  console.log("5b) invoice.paid promotes the card to customer default…");
  const firstInvoice = await stripe.invoices.retrieve(
    typeof (await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId!, { expand: ["latest_invoice"] }))
      .latest_invoice === "string"
      ? ((await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId!)).latest_invoice as string)
      : ((await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId!, { expand: ["latest_invoice"] })).latest_invoice as import("stripe").Stripe.Invoice).id!,
  );
  const wh = await fetch(`${process.env.SMOKE_BASE_URL ?? "http://localhost:3000"}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: `evt_v2_${Date.now()}`, type: "invoice.paid", data: { object: firstInvoice } }),
  });
  assert(wh.ok, `webhook replay ${wh.status}`);
  const cust = (await stripe.customers.retrieve(
    (await db.query.organization.findFirst({ where: eq(organization.id, org.id) }))!.stripeCustomerId!,
  )) as import("stripe").Stripe.Customer;
  assert(cust.invoice_settings?.default_payment_method, "customer default PM set");

  console.log("6) manual invoice collect=auto charges the card on file…");
  const man = await createManualInvoice({
    tenantId: org.id,
    lineItems: [{ name: "Thank-you build contribution", amountCents: 20000 }],
    daysUntilDue: 7,
    contact: { email: u.email, name: u.name },
    collect: "auto",
  });
  assert(man.autoCharged, "auto-charge path taken (card on file)");
  const manStripe = await stripe.invoices.retrieve(
    (await db.query.invoices.findFirst({ where: eq(invoices.id, man.invoiceId) }))!.stripeInvoiceId!,
  );
  assert(manStripe.status === "paid", `manual invoice ${manStripe.status}, expected paid`);

  console.log("cleanup…");
  if (localSub.stripeSubscriptionId) await stripe.subscriptions.cancel(localSub.stripeSubscriptionId).catch(() => {});
  const orgRow = await db.query.organization.findFirst({ where: eq(organization.id, org.id) });
  if (orgRow?.stripeCustomerId) await stripe.customers.del(orgRow.stripeCustomerId).catch(() => {});
  await db.delete(organization).where(eq(organization.id, org.id)); // cascades items first
  await db.delete(productComponents).where(eq(productComponents.id, quarterly.id));
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
