/**
 * Ops "start subscription" smoke (Stripe TEST MODE, local DB, no dev server).
 * Covers: backdated start collected by emailed invoice (per-month catch-up
 * lines, quantities, offline-paid one-time work, persisted overrides, audit),
 * the webhook echo guard, paying the catch-up by card, quantity bumps and
 * Stripe-side quantity reconciliation, charge-card-now, an all-offline
 * one-time start, a paid-offline manual invoice, and the setup-link path
 * (offline invoice at link creation, backdated checkout in setup mode,
 * finalize paying the catch-up with the saved card).
 *
 * Run: node --env-file=.env --import tsx scripts/smoke-ops-start.ts
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { monthKey } from "../src/lib/dates";
import { member, organization, user } from "../src/modules/auth/schema";
import { productComponents, products } from "../src/modules/catalog/schema";
import { invoices, subscriptionItems, subscriptions, tenantPriceOverrides } from "../src/modules/billing/schema";
import { payments } from "../src/modules/billing/ar-schema";
import { auditLogs } from "../src/modules/audit/schema";
import {
  applyInvoiceEvent,
  applySubscriptionEvent,
  changeSubscriptionItems,
  createCheckout,
  ensureTenantStripeCustomer,
} from "../src/modules/billing/service";
import { createManualInvoice } from "../src/modules/billing/ar-service";
import { startSubscriptionByOps } from "../src/modules/billing/start-service";
import { listAllSubscriptionsOps, listTenantSubscriptions } from "../src/modules/billing/queries";
import { buildStartPlan, type StartItemInput } from "../src/modules/billing/start-logic";
import { itemMrrCents } from "../src/modules/billing/mappers";
import {
  applyInvitePricing,
  checkoutTermsForEntry,
  createClientSetup,
  getSetupByToken,
  runFinalize,
} from "../src/modules/onboarding/service";
import { entryComponentIds } from "../src/modules/onboarding/proposal";
import { onboardingInvites } from "../src/modules/onboarding/schema";

const stripe = getStripe();
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const ts = (d: Date) => Math.floor(d.getTime() / 1000);

async function fixture(tag: string) {
  const [u] = await db
    .insert(user)
    .values({
      id: `${tag}_${Date.now()}`,
      name: `${tag} Owner`,
      email: `${tag}_${Date.now()}@example.com`.toLowerCase(), // the setup service lowercases lookups
      emailVerified: true,
      firstName: tag,
      lastName: "Owner",
      phone: "+15550005555",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: `${tag} Co`, slug: `${tag}-${Date.now()}`.toLowerCase(), status: "active", createdAt: new Date() })
    .returning();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() });
  return { u, org, contact: { email: u.email, name: u.name } };
}

async function cardFor(customerId: string): Promise<string> {
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  return pm.id;
}

async function main() {
  const custom = await db.query.products.findFirst({ where: eq(products.slug, "custom-application") });
  assert(custom, "custom-application seeded");
  const comps = await db.query.productComponents.findMany({
    where: and(eq(productComponents.productId, custom.id), eq(productComponents.isActive, true)),
  });
  const base = comps.find((c) => c.role === "base")!;
  const appHosting = comps.find((c) => c.name === "Application Hosting")!;
  const domain = comps.find((c) => c.name === "Domain Renewal")!;
  const build = comps.find((c) => c.name === "Website Application Build")!;
  assert(base && appHosting && domain && build, "expected components present");
  assert(domain.interval === "year", "Domain Renewal is yearly");
  const negotiated = (comp: typeof base) =>
    comp.id === base.id ? 4000 : comp.id === appHosting.id ? 100 : comp.id === domain.id ? 100 : comp.id === build.id ? 50000 : comp.amountCents;
  const dealItems = (offline: boolean): StartItemInput[] =>
    comps.map((c) => ({
      componentId: c.id,
      amountCents: negotiated(c),
      quantity: c.id === appHosting.id ? 2 : 1,
      ...(c.id === build.id && offline
        ? { settlement: { mode: "offline" as const, payment: { method: "cash" as const, reference: "cash 9/20", receivedAt: new Date(Date.now() - 86_400_000).toISOString() } } }
        : {}),
    }));
  const startComps = comps.map((c) => ({
    id: c.id, name: c.name, kind: c.kind, role: c.role, interval: c.interval, intervalCount: c.intervalCount,
    isRequired: c.isRequired, isActive: c.isActive, listCents: c.amountCents,
  }));
  const now = new Date();
  const nowKey = monthKey(now);
  const billFrom = `${nowKey.slice(0, 4)}-${nowKey.slice(5)}` === nowKey ? (() => { const d = new Date(Date.UTC(Number(nowKey.slice(0, 4)), Number(nowKey.slice(5)) - 3, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; })() : nowKey;
  const planned = buildStartPlan({ items: dealItems(true), components: startComps, skipTrial: true, billFromMonth: billFrom, now });
  assert(planned.ok, `plan builds: ${planned.ok ? "" : planned.errors.join(", ")}`);
  const plan = planned.plan;
  assert(plan.backdate && plan.backdate.months.length === 3, "three catch-up months");

  const A = await fixture("opsA");
  const B = await fixture("opsB");
  const C = await fixture("opsC");
  const cleanup: (() => Promise<void>)[] = [];

  try {
    console.log("0) an expired subscription for the same product must not block a fresh start…");
    await db.insert(subscriptions).values({ tenantId: A.org.id, productId: custom.id, status: "expired" });

    console.log(`1) start now (emailed invoice), backdated to ${billFrom}, $500 build paid in cash…`);
    const r = await startSubscriptionByOps({
      tenantId: A.org.id, productId: custom.id, items: dealItems(true),
      collection: { mode: "send_invoice", daysUntilDue: 14 }, billFromMonth: billFrom,
      skipTrial: true, persistOverrides: true, actorUserId: A.u.id, contact: A.contact,
    });
    assert(r.status === "active", `local status ${r.status}`);
    assert(r.stripeSubscriptionId, "stripe sub created");
    assert(r.offlineInvoice && !r.offlineInvoiceError, `offline invoice recorded (${r.offlineInvoiceError ?? ""})`);
    assert(r.catchUp?.months.length === 3 && r.catchUp.cents === plan.backdate!.cents, "catch-up months + cents");
    const ss = await stripe.subscriptions.retrieve(r.stripeSubscriptionId, { expand: ["items.data.price"] });
    assert(ss.status === "active" && ss.collection_method === "send_invoice" && ss.days_until_due === 14, "stripe sub active, send_invoice, 14d");
    assert(ss.start_date === ts(plan.backdate!.startAt), `start_date ${ss.start_date} == ${ts(plan.backdate!.startAt)}`);
    assert(ss.billing_cycle_anchor === ts(plan.backdate!.anchorAt), "anchor = 1st of next month");
    const qtyOf = (priceUnit: number) => ss.items.data.find((i) => i.price.unit_amount === priceUnit)?.quantity;
    assert(qtyOf(100) === 2 || ss.items.data.some((i) => i.quantity === 2), "app hosting quantity 2 in Stripe");
    assert(r.firstInvoice && r.firstInvoice.status === "open" && r.firstInvoice.localInvoiceId, "first (catch-up) invoice open + mirrored");
    const first = await stripe.invoices.retrieve(r.firstInvoice.stripeInvoiceId);
    // invoice.lines is paginated (10 per page) — list them all.
    const firstLines = (await stripe.invoices.listLineItems(first.id!, { limit: 100 })).data;
    assert(first.amount_due === plan.totals.firstInvoiceCents, `catch-up amount ${first.amount_due} == ${plan.totals.firstInvoiceCents}`);
    assert(firstLines.length === plan.backdate!.lines.length, `catch-up line count ${firstLines.length} == ${plan.backdate!.lines.length}`);
    assert(firstLines.every((l) => l.parent?.type === "invoice_item_details"), "no Stripe-generated (proration) lines");
    assert(firstLines.every((l) => l.period && l.period.end > l.period.start), "every line carries a period");
    assert(!firstLines.some((l) => l.amount === 50000), "cash-paid build is not on the catch-up invoice");
    assert(first.hosted_invoice_url, "hosted invoice url");
    const localSub = (await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, r.subscriptionId) }))!;
    assert(localSub.status === "active" && localSub.subscribedAt.getTime() === plan.backdate!.startAt.getTime(), "local sub active, since = bill-from");
    const items = await db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, r.subscriptionId) });
    assert(items.length === comps.length, "every component snapshotted");
    const appItem = items.find((i) => i.componentId === appHosting.id)!;
    assert(appItem.quantity === 2 && appItem.amountCents === 100, "quantity 2 @ $1.00 snapshot");
    const buildItem = items.find((i) => i.componentId === build.id)!;
    assert(buildItem.status === "paid" && buildItem.amountCents === 50000 && !buildItem.stripePriceId, "cash-paid build item paid, no price");
    const localFirst = (await db.query.invoices.findFirst({ where: eq(invoices.id, r.firstInvoice.localInvoiceId!) }))!;
    assert(localFirst.status === "open" && localFirst.subscriptionId === r.subscriptionId && localFirst.billingMonth === billFrom, "catch-up invoice mirrored with bill-from month");
    assert(localFirst.lineItems.some((l) => l.periodStart), "mirrored lines carry periods");
    const offInv = (await db.query.invoices.findFirst({ where: eq(invoices.id, r.offlineInvoice.invoiceId) }))!;
    assert(offInv.status === "paid" && offInv.subscriptionId === r.subscriptionId && offInv.kind === "product", "offline invoice paid + linked");
    assert(offInv.paidAt && Math.abs(offInv.paidAt.getTime() - (Date.now() - 86_400_000)) < 60_000, "paidAt = received date");
    const offStripe = await stripe.invoices.retrieve(offInv.stripeInvoiceId!);
    assert(offStripe.status === "paid" && offStripe.metadata?.settlement === "offline", "stripe offline invoice paid + tagged");
    const pays = await db.query.payments.findMany({ where: eq(payments.invoiceId, offInv.id) });
    assert(pays.length === 1 && pays[0].method === "cash" && pays[0].reference === "cash 9/20" && pays[0].recordedByUserId === A.u.id, "one cash payment row");
    const ovs = await db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, A.org.id) });
    assert(ovs.some((o) => o.componentId === base.id && o.amountCents === 4000), "base override persisted");
    assert(ovs.some((o) => o.componentId === appHosting.id && o.amountCents === 100), "add-on override persisted");
    assert(!ovs.some((o) => o.componentId === build.id), "offline line never becomes an override");
    const audits = await db.query.auditLogs.findMany({ where: eq(auditLogs.tenantId, A.org.id) });
    assert(audits.some((a) => a.kind === "subscription_started_by_ops") && audits.some((a) => a.kind === "offline_payment_recorded"), "audit kinds written");

    console.log("2) readers multiply by quantity…");
    const dto = (await listTenantSubscriptions(A.org.id)).find((s) => s.id === r.subscriptionId)!;
    const expectedMrr = items.filter((i) => i.status === "active").reduce((s, i) => s + itemMrrCents(i, i.amountCents * i.quantity), 0);
    assert(dto.monthlyCents === expectedMrr && dto.items.find((i) => i.name === "Application Hosting")?.quantity === 2, "MRR × quantity, DTO quantity");
    const opsRow = (await listAllSubscriptionsOps()).find((s) => s.id === r.subscriptionId)!;
    assert(opsRow.addons.includes("Application Hosting ×2"), `ops board shows ×2 (${opsRow.addons.join(", ")})`);

    console.log("3) webhook echo of the offline invoice changes nothing…");
    await applyInvoiceEvent(offStripe, "invoice.paid");
    assert((await db.query.payments.findMany({ where: eq(payments.invoiceId, offInv.id) })).length === 1, "still one payment row");
    assert((await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, r.subscriptionId) }))!.status === "active", "sub untouched");

    console.log("4) the client pays the catch-up by card; the webhook mirrors it…");
    const custA = (await db.query.organization.findFirst({ where: eq(organization.id, A.org.id) }))!.stripeCustomerId!;
    const pmA = await cardFor(custA);
    await stripe.invoices.pay(first.id!, { payment_method: pmA });
    await applyInvoiceEvent(await stripe.invoices.retrieve(first.id!), "invoice.paid");
    const paidFirst = (await db.query.invoices.findFirst({ where: eq(invoices.id, localFirst.id) }))!;
    assert(paidFirst.status === "paid", "catch-up invoice paid locally");
    const firstPays = await db.query.payments.findMany({ where: eq(payments.invoiceId, localFirst.id) });
    assert(firstPays.length === 1 && firstPays[0].method === "stripe_card", "card payment row");

    console.log("5) quantity bumps and Stripe-side reconciliation…");
    const [tmp] = await db.insert(productComponents).values({
      productId: custom.id, kind: "recurring", interval: "month", intervalCount: 1, role: "addon",
      name: `Smoke Seat ${Date.now()}`, amountCents: 300, sortOrder: 97,
    }).returning();
    cleanup.push(async () => { await db.delete(productComponents).where(eq(productComponents.id, tmp.id)); });
    const a1 = await changeSubscriptionItems({ subscriptionId: r.subscriptionId, addItems: [{ componentId: tmp.id, quantity: 3 }], actorUserId: A.u.id });
    assert(a1.added === 1, "seat added");
    const a2 = await changeSubscriptionItems({ subscriptionId: r.subscriptionId, addItems: [{ componentId: tmp.id, quantity: 2 }], actorUserId: A.u.id });
    assert(a2.added === 1, "seat grown");
    const seatRows = await db.query.subscriptionItems.findMany({ where: and(eq(subscriptionItems.subscriptionId, r.subscriptionId), eq(subscriptionItems.componentId, tmp.id)) });
    assert(seatRows.length === 1 && seatRows[0].quantity === 5, `one seat row at qty 5 (got ${seatRows.map((s) => s.quantity).join(",")})`);
    const seatStripe = (await stripe.subscriptions.retrieve(r.stripeSubscriptionId)).items.data.find((i) => i.id === seatRows[0].stripeSubscriptionItemId)!;
    assert(seatStripe.quantity === 5, "stripe qty 5");
    await stripe.subscriptionItems.update(seatStripe.id, { quantity: 7, proration_behavior: "none" });
    await applySubscriptionEvent(await stripe.subscriptions.retrieve(r.stripeSubscriptionId));
    assert((await db.query.subscriptionItems.findFirst({ where: eq(subscriptionItems.id, seatRows[0].id) }))!.quantity === 7, "Dashboard quantity change mirrored");

    console.log("6) charge the card on file now (no backdate)…");
    const custB = await ensureTenantStripeCustomer(B.org.id, B.contact);
    await cardFor(custB);
    const rb = await startSubscriptionByOps({
      tenantId: B.org.id, productId: custom.id, items: dealItems(false),
      collection: { mode: "charge_card_now" }, skipTrial: true, persistOverrides: false, actorUserId: B.u.id, contact: B.contact,
    });
    assert(rb.paymentStatus === "paid" && rb.status === "active", `charged now: ${rb.paymentStatus} / ${rb.status}`);
    assert(rb.firstInvoice?.status === "paid", "first invoice paid");
    const bItems = await db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, rb.subscriptionId) });
    assert(bItems.find((i) => i.componentId === build.id)!.status === "paid", "invoice-settled build paid after charge");
    assert((await db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, B.org.id) })).length === 0, "no overrides when not persisting");

    console.log("7) all-offline one-time-only: no Stripe subscription…");
    const [oneOff] = await db.insert(products).values({
      slug: `smoke-onetime-${Date.now()}`, name: "Smoke One-time", category: "Smoke", description: "smoke", isActive: true, sortOrder: 999,
    }).returning();
    const [oneOffComp] = await db.insert(productComponents).values({
      productId: oneOff.id, kind: "one_time", role: "addon", name: "Audit", amountCents: 5000, sortOrder: 0,
    }).returning();
    cleanup.push(async () => {
      await db.delete(productComponents).where(eq(productComponents.id, oneOffComp.id));
      await db.delete(products).where(eq(products.id, oneOff.id));
    });
    const rc = await startSubscriptionByOps({
      tenantId: B.org.id, productId: oneOff.id,
      items: [{ componentId: oneOffComp.id, amountCents: 5000, quantity: 1, settlement: { mode: "offline", payment: { method: "check", reference: "1001" } } }],
      collection: { mode: "send_invoice", daysUntilDue: 14 }, skipTrial: true, persistOverrides: true, actorUserId: B.u.id, contact: B.contact,
    });
    assert(!rc.stripeSubscriptionId && rc.status === "active" && rc.firstInvoice === null && rc.offlineInvoice, "no stripe sub, active, offline invoice");

    console.log("8) manual invoice already paid offline…");
    const man = await createManualInvoice({
      tenantId: B.org.id, lineItems: [{ name: "Binders", amountCents: 2500 }], daysUntilDue: 14, contact: B.contact,
      collect: "paid_offline", payment: { method: "cash" }, recordedByUserId: B.u.id,
    });
    assert(man.settledOffline, "settledOffline");
    const manRow = (await db.query.invoices.findFirst({ where: eq(invoices.id, man.invoiceId) }))!;
    assert(manRow.status === "paid" && manRow.kind === "manual", "manual invoice paid");
    const manStripe = await stripe.invoices.retrieve(manRow.stripeInvoiceId!);
    assert(manStripe.status === "paid", "stripe paid (out of band)");

    console.log("9) setup link: cash recorded at creation, backdated checkout in setup mode, finalize pays the catch-up…");
    const setup = await createClientSetup({
      clientName: C.u.name, clientEmail: C.u.email, tenantName: C.org.name, tenantId: C.org.id,
      products: [{ productId: custom.id, billFromMonth: billFrom, items: comps.map((c) => ({
        componentId: c.id, priceCents: negotiated(c), quantity: c.id === appHosting.id ? 2 : 1,
        ...(c.id === build.id ? { settlement: { mode: "offline" as const, payment: { method: "cash" as const, reference: "cash at signing" } } } : {}),
      })) }],
      sendEmailToClient: false, actorUserId: A.u.id,
    });
    const preInv = await db.query.invoices.findMany({ where: eq(invoices.tenantId, C.org.id) });
    assert(preInv.length === 1 && preInv[0].status === "paid" && preInv[0].subscriptionId === null, "offline invoice paid at link creation, unlinked");
    const token = setup.link.split("/").pop()!;
    const proposal = (await getSetupByToken(token))!;
    const pp = proposal.products[0];
    assert(pp.lines.find((l) => l.name === build.name)?.settled, "proposal shows build as paid");
    assert(pp.catchUpCents > 0 && pp.dueTodayCents === pp.catchUpCents, `due today = catch-up (${pp.dueTodayCents} vs ${pp.catchUpCents})`);
    const inviteRow = (await db.query.onboardingInvites.findFirst({ where: eq(onboardingInvites.id, setup.inviteId) }))!;
    const entry = inviteRow.products[0];
    await applyInvitePricing(inviteRow.id, null);
    const co = await createCheckout({
      tenantId: C.org.id, productId: custom.id, componentIds: entryComponentIds(entry),
      ...(await checkoutTermsForEntry(entry, C.org.id)),
      contact: C.contact, skipAutoPromos: true, userId: C.u.id,
    });
    assert(co.mode === "setup" && co.clientSecret, `setup mode to save the card (got ${co.mode})`);
    assert(co.status === "active" && co.firstInvoice?.status === "open", "backdated sub active, catch-up open");
    const cItems = await db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, co.subscriptionId) });
    assert(cItems.find((i) => i.componentId === build.id)!.status === "paid", "build item paid from the link");
    assert(cItems.find((i) => i.componentId === appHosting.id)!.quantity === 2, "quantity honored from the link");
    const linked = (await db.query.invoices.findFirst({ where: eq(invoices.id, preInv[0].id) }))!;
    assert(linked.subscriptionId === co.subscriptionId, "offline invoice linked to the new subscription");
    const custC = (await db.query.organization.findFirst({ where: eq(organization.id, C.org.id) }))!.stripeCustomerId!;
    const pmC = await cardFor(custC);
    await stripe.subscriptions.update(co.stripeSubscriptionId!, { default_payment_method: pmC });
    const fin = await runFinalize(inviteRow.id);
    assert(fin.state === "complete", `finalize ${fin.state}`);
    const cCatchUp = (await db.query.invoices.findFirst({ where: eq(invoices.id, co.firstInvoice.localInvoiceId!) }))!;
    assert(cCatchUp.status === "paid", "catch-up paid by the saved card");
    assert((await stripe.invoices.retrieve(co.firstInvoice.stripeInvoiceId)).status === "paid", "stripe catch-up paid");

    console.log("✅ smoke-ops-start passed");
  } finally {
    console.log("cleanup…");
    for (const f of [A, B, C]) {
      const orgRow = await db.query.organization.findFirst({ where: eq(organization.id, f.org.id) });
      if (orgRow?.stripeCustomerId) {
        const subs = await stripe.subscriptions.list({ customer: orgRow.stripeCustomerId, status: "all", limit: 20 });
        for (const s of subs.data) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe.subscriptions.cancel(s.id).catch(() => {});
        await stripe.customers.del(orgRow.stripeCustomerId).catch(() => {});
      }
      await db.delete(organization).where(eq(organization.id, f.org.id));
      await db.delete(user).where(eq(user.id, f.u.id));
    }
    for (const c of cleanup.reverse()) await c().catch((e) => console.error("cleanup step failed:", e));
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
