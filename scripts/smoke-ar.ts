/**
 * Billing ops & continuity smoke (Stripe TEST MODE).
 * Covers: manual Stripe-hosted invoice, partial + settling offline payments,
 * out-of-band Stripe mark, dunning reminders → suspension → auto-reactivation,
 * hosting invoice generation idempotency.
 *
 * Run: node --env-file=.env --import tsx scripts/smoke-ar.ts
 */
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { getStripe } from "../src/lib/stripe";
import { member, organization, user } from "../src/modules/auth/schema";
import { products } from "../src/modules/catalog/schema";
import { invoices, subscriptions } from "../src/modules/billing/schema";
import { dunningStates, payments } from "../src/modules/billing/ar-schema";
import {
  createManualInvoice,
  generateHostingInvoices,
  previousMonth,
  recordOfflinePayment,
  runDunningSweep,
  setHostingFee,
} from "../src/modules/billing/ar-service";

const stripe = getStripe();
const DAY = 86_400_000;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  const uid = `ar_${Date.now()}`;
  const [u] = await db
    .insert(user)
    .values({
      id: uid, name: "AR Tester", email: `${uid}@example.com`, emailVerified: true,
      firstName: "AR", lastName: "Tester", phone: "+15550003333",
      createdAt: new Date(), updatedAt: new Date(),
    })
    .returning();
  const [org] = await db
    .insert(organization)
    .values({ id: crypto.randomUUID(), name: "AR Corp", slug: `ar-${Date.now()}`, status: "active", createdAt: new Date() })
    .returning();
  await db.insert(member).values({ id: crypto.randomUUID(), organizationId: org.id, userId: u.id, role: "owner", createdAt: new Date() });

  // A live subscription so suspension/reactivation has something to act on.
  const anyProduct = await db.query.products.findFirst();
  const [sub] = await db
    .insert(subscriptions)
    .values({ tenantId: org.id, productId: anyProduct!.id, status: "active" })
    .returning();

  console.log("1) manual Stripe-hosted invoice…");
  const inv = await createManualInvoice({
    tenantId: org.id,
    lineItems: [
      { name: "Custom integration work", amountCents: 150000 },
      { name: "Rush fee", amountCents: 25000 },
    ],
    daysUntilDue: 14,
    memo: "Smoke test invoice",
    contact: { email: u.email, name: u.name },
  });
  assert(inv.hostedInvoiceUrl, "hosted payment link exists");
  const localInv = await db.query.invoices.findFirst({ where: eq(invoices.id, inv.invoiceId) });
  assert(localInv?.kind === "manual" && localInv.amountDueCents === 175000, "mirrored as manual $1,750");

  console.log("2) partial offline payment ($1,000 check)…");
  const p1 = await recordOfflinePayment({
    invoiceId: inv.invoiceId, amountCents: 100000, method: "check",
    reference: "CHK-1042", recordedByUserId: u.id,
  });
  assert(!p1.settled, "partial payment does not settle");
  let after = await db.query.invoices.findFirst({ where: eq(invoices.id, inv.invoiceId) });
  assert(after?.status === "open" && after.amountPaidCents === 100000, "open with $1,000 recorded");

  console.log("3) settling payment ($750 Zelle) → out-of-band paid…");
  const p2 = await recordOfflinePayment({
    invoiceId: inv.invoiceId, amountCents: 75000, method: "zelle",
    reference: "ZL-889", recordedByUserId: u.id,
  });
  assert(p2.settled, "second payment settles");
  after = await db.query.invoices.findFirst({ where: eq(invoices.id, inv.invoiceId) });
  assert(after?.status === "paid", "local invoice paid");
  const stripeInv = await stripe.invoices.retrieve(after.stripeInvoiceId!);
  assert(stripeInv.status === "paid", "stripe invoice marked paid out-of-band");
  const payRows = await db.query.payments.findMany({ where: eq(payments.invoiceId, inv.invoiceId) });
  assert(payRows.length === 2, "two ledger rows");

  console.log("4) dunning: overdue invoice → reminders → suspension…");
  const dun = await createManualInvoice({
    tenantId: org.id,
    lineItems: [{ name: "Overdue work", amountCents: 50000 }],
    daysUntilDue: 7,
    contact: { email: u.email, name: u.name },
  });
  const now = new Date();
  // Time-travel: due 20 days ago.
  await db.update(invoices).set({ dueDate: new Date(now.getTime() - 20 * DAY) }).where(eq(invoices.id, dun.invoiceId));

  let r = await runDunningSweep(new Date(now.getTime() - 16 * DAY)); // 4 days past due
  assert(r.reminded >= 1, "first reminder fired");
  r = await runDunningSweep(new Date(now.getTime() - 16 * DAY));
  assert(r.reminded === 0, "no duplicate reminder same day");
  r = await runDunningSweep(new Date(now.getTime() - 12 * DAY)); // 8 days past due
  assert(r.reminded >= 1, "second reminder fired");
  r = await runDunningSweep(now); // 20 days past due ≥ 14-day grace
  assert(r.suspended >= 1, "suspension fired");
  const subAfter = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) });
  assert(subAfter?.status === "suspended", "subscription suspended");

  console.log("5) payment lands → auto-reactivation…");
  const p3 = await recordOfflinePayment({
    invoiceId: dun.invoiceId, amountCents: 50000, method: "wire",
    reference: "WIRE-7", recordedByUserId: u.id,
  });
  assert(p3.settled, "overdue invoice settled");
  const subFinal = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) });
  assert(subFinal?.status === "active", `subscription reactivated (got ${subFinal?.status})`);
  const dcase = await db.query.dunningStates.findFirst({
    where: and(eq(dunningStates.invoiceId, dun.invoiceId)),
  });
  assert(dcase?.resolvedAt, "dunning case resolved");

  console.log("6) hosting invoice generation idempotency…");
  await setHostingFee(sub.id, 7900, "2026-01");
  const month = previousMonth();
  const g1 = await generateHostingInvoices(month);
  assert(g1.created === 1, `hosting invoice created (${g1.created})`);
  const g2 = await generateHostingInvoices(month);
  assert(g2.created === 0 && g2.skipped >= 1, "second run skips (idempotent)");
  const hostInv = await db.query.invoices.findFirst({
    where: and(eq(invoices.subscriptionId, sub.id), eq(invoices.kind, "hosting")),
  });
  assert(hostInv?.billingMonth === month && hostInv.amountDueCents === 7900, "hosting invoice $79 for last month");

  console.log("cleanup…");
  for (const i of await db.query.invoices.findMany({ where: eq(invoices.tenantId, org.id) })) {
    if (i.stripeInvoiceId && i.status !== "paid") {
      await stripe.invoices.voidInvoice(i.stripeInvoiceId).catch(() => {});
    }
  }
  const orgRow = await db.query.organization.findFirst({ where: eq(organization.id, org.id) });
  if (orgRow?.stripeCustomerId) await stripe.customers.del(orgRow.stripeCustomerId).catch(() => {});
  await db.delete(organization).where(eq(organization.id, org.id));
  await db.delete(user).where(eq(user.id, u.id));

  console.log("\n✅ BILLING OPS & CONTINUITY SMOKE: ALL PASSED");
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error("\n❌", e.message);
    await pool.end();
    process.exit(1);
  });
