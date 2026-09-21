/**
 * Backdate spike v2 (Stripe TEST MODE, no DB). Verifies, on the real API:
 *  1. backdate_start_date + future billing_cycle_anchor + proration_behavior
 *     "none" (+ billing_mode flexible) yields an active sub with NO Stripe
 *     first invoice and no Stripe-generated lines for the backdated span;
 *  2. a Hub-created invoice tied to that subscription (pending items excluded)
 *     carries our per-month lines with periods plus a one-time price line,
 *     finalizes, and links back to the subscription;
 *  3. the card-collecting variant (payment_behavior default_incomplete) still
 *     exposes a pending_setup_intent so the welcome page can save a card;
 *  4. the next regular invoice contains only the anchor period.
 * Run: node --env-file=.env --import tsx scripts/spike-backdate.ts
 */
import type Stripe from "stripe";
import { getStripe } from "../src/lib/stripe";

const stripe = getStripe();
const ts = (d: Date) => Math.floor(d.getTime() / 1000);
const iso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);
const day = (s: number | null | undefined) => iso(s)?.slice(0, 10) ?? null;
const first = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const j = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function scenario(label: string, collection: "send_invoice" | "card") {
  console.log(`\n=== ${label}`);
  const tag = `spike_${Date.now()}`;
  const customer = await stripe.customers.create({ email: `${tag}@example.com`, name: "Backdate Spike" });
  const product = await stripe.products.create({ name: `Spike ${tag}` });
  const price = (unit_amount: number, recurring?: { interval: "month" | "year" }) =>
    stripe.prices.create({ product: product.id, currency: "usd", unit_amount, ...(recurring ? { recurring } : {}) });
  const [monthly, addon, yearly, oneTime] = await Promise.all([
    price(4000, { interval: "month" }),
    price(100, { interval: "month" }),
    price(100, { interval: "year" }),
    price(50000),
  ]);
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startAt = first(y, m - 2);
  const anchorAt = first(y, m + 1);
  const months = [first(y, m - 2), first(y, m - 1), first(y, m)];

  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [
      { price: monthly.id, quantity: 1 },
      { price: addon.id, quantity: 2 },
      { price: yearly.id, quantity: 1 },
    ],
    ...(collection === "send_invoice"
      ? { collection_method: "send_invoice" as const, days_until_due: 14 }
      : {
          payment_behavior: "default_incomplete" as const,
          payment_settings: { save_default_payment_method: "on_subscription" as const },
        }),
    backdate_start_date: ts(startAt),
    billing_cycle_anchor: ts(anchorAt),
    proration_behavior: "none",
    billing_mode: { type: "flexible" },
    metadata: { spike: tag },
    expand: ["latest_invoice", "pending_setup_intent"],
  });
  j({
    status: sub.status,
    collection_method: sub.collection_method,
    start_date: day(sub.start_date),
    anchor: day(sub.billing_cycle_anchor),
    latest_invoice: (sub.latest_invoice as Stripe.Invoice | null)?.id ?? null,
    pending_setup_intent: sub.pending_setup_intent && typeof sub.pending_setup_intent !== "string" ? { id: sub.pending_setup_intent.id, secret: Boolean(sub.pending_setup_intent.client_secret) } : sub.pending_setup_intent,
    default_payment_method: sub.default_payment_method,
  });

  // 2. the Hub-made catch-up invoice, tied to the subscription
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    subscription: sub.id,
    auto_advance: false,
    ...(collection === "send_invoice"
      ? { collection_method: "send_invoice" as const, days_until_due: 14 }
      : { collection_method: "charge_automatically" as const }),
    description: "Spike — billed from two months ago",
    metadata: { subscription_id: "local-sub", tenant_id: "local-tenant", catch_up: "1" },
  });
  for (const [i, s] of months.entries()) {
    const e = first(s.getUTCFullYear(), s.getUTCMonth() + 1);
    await stripe.invoiceItems.create({ customer: customer.id, invoice: invoice.id, amount: 4000, currency: "usd", description: `Subscription — month ${i + 1}`, period: { start: ts(s), end: ts(e) }, metadata: { component_id: "sub", quantity: "1" } });
    await stripe.invoiceItems.create({ customer: customer.id, invoice: invoice.id, amount: 200, currency: "usd", description: `Extra ×2 — month ${i + 1}`, period: { start: ts(s), end: ts(e) } });
  }
  await stripe.invoiceItems.create({ customer: customer.id, invoice: invoice.id, amount: 25, currency: "usd", description: "Yearly — prorated", period: { start: ts(startAt), end: ts(anchorAt) } });
  await stripe.invoiceItems.create({ customer: customer.id, invoice: invoice.id, pricing: { price: oneTime.id }, quantity: 1, description: "One-time build" });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!, { expand: ["confirmation_secret", "lines"] });
  j({
    invoice: finalized.id,
    status: finalized.status,
    amount_due: finalized.amount_due,
    collection: finalized.collection_method,
    due_date: day(finalized.due_date),
    hosted: Boolean(finalized.hosted_invoice_url),
    confirmation_secret: Boolean(finalized.confirmation_secret?.client_secret),
    parent: finalized.parent?.type ?? null,
    parent_sub: finalized.parent?.subscription_details?.subscription ?? null,
    lines: finalized.lines.data.map((l) => ({ desc: l.description, amount: l.amount, qty: l.quantity, period: `${day(l.period?.start)} → ${day(l.period?.end)}`, parent: l.parent?.type ?? null })),
  });
  if (collection === "send_invoice") {
    await stripe.invoices.sendInvoice(finalized.id!);
    console.log("sendInvoice ok");
  }

  // 4. next regular invoice
  const preview = await stripe.invoices.createPreview({ customer: customer.id, subscription: sub.id });
  j({ next_amount_due: preview.amount_due, next_lines: preview.lines.data.map((l) => ({ desc: l.description, amount: l.amount, period: `${day(l.period?.start)} → ${day(l.period?.end)}` })) });
  const pending = await stripe.invoiceItems.list({ customer: customer.id, pending: true, limit: 50 });
  console.log("pending items left:", pending.data.length);

  // cleanup
  await stripe.subscriptions.cancel(sub.id);
  await stripe.invoices.voidInvoice(finalized.id!).catch(() => {});
  await stripe.customers.del(customer.id);
  await stripe.products.update(product.id, { active: false });
  console.log("cleaned up");
}

async function main() {
  // Sweep scratch customers a crashed run left behind (deleting a customer cancels its subscriptions).
  const stale = await stripe.customers.search({ query: "email~'spike_'", limit: 20 });
  for (const c of stale.data) await stripe.customers.del(c.id).catch(() => {});
  console.log("swept stale spike customers:", stale.data.length);
  await scenario("send_invoice (ops start now, no card)", "send_invoice");
  await scenario("card (setup link / charge card)", "card");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
