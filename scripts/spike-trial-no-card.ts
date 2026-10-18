/**
 * Trial-without-card spike (Stripe TEST MODE, test clocks, no DB). Mirrors
 * createCheckout's subscription params for a trial product with no one-time
 * charge, then verifies on the real API:
 *  A. no card: trialing immediately (nothing to pay), a pending SetupIntent
 *     exists; with trial_settings missing_payment_method "cancel" (what the
 *     Partner API sets) Stripe ends the subscription at the trial end with
 *     NO invoice and no payment_failed — Hub's isTrialLapse maps it to
 *     `expired` (no dunning).
 *  B. card added mid-trial by confirming the subscription's pending
 *     SetupIntent: within seconds it becomes the subscription's default
 *     payment method (asynchronously), and the first invoice at trial end is
 *     paid automatically. The customer-level default stays unset.
 * Run: node --env-file=.env --import tsx scripts/spike-trial-no-card.ts
 */
import type Stripe from "stripe";
import { getStripe } from "../src/lib/stripe";
import { isTrialLapse } from "../src/modules/billing/mappers";

const stripe = getStripe();
const DAY = 86_400;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function advance(clockId: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (c.status === "ready") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("test clock did not settle");
}

async function scenario(label: string, addCard: boolean) {
  console.log(`\n=== ${label}`);
  const now = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now, name: `trial-spike-${now}` });
  try {
    const customer = await stripe.customers.create({ email: `trial_spike_${now}@example.com`, test_clock: clock.id });
    const product = await stripe.products.create({ name: `Trial spike ${now}` });
    const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 3500, recurring: { interval: "month" } });

    // Same params createCheckout uses for a card checkout with a trial.
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id, quantity: 1 }],
      billing_mode: { type: "flexible" },
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      trial_period_days: 30,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
    });
    const inv0 = sub.latest_invoice as Stripe.Invoice;
    console.log(`status=${sub.status} first invoice=${inv0?.amount_due} setupIntent=${typeof sub.pending_setup_intent === "object" ? sub.pending_setup_intent?.status : sub.pending_setup_intent}`);
    assert(sub.status === "trialing", "trialing at once without a card");
    assert(!inv0 || inv0.amount_due === 0, "nothing due today");
    assert(sub.pending_setup_intent && typeof sub.pending_setup_intent === "object", "pending SetupIntent offered");
    assert(sub.trial_settings?.end_behavior?.missing_payment_method === "cancel", "lapse rule set");

    if (addCard) {
      await advance(clock.id, now + 10 * DAY);
      const si = sub.pending_setup_intent as Stripe.SetupIntent;
      await stripe.setupIntents.confirm(si.id, { payment_method: "pm_card_visa" });
      // Stripe attaches the SetupIntent's card as the subscription default
      // asynchronously (seconds) — no Hub-side step needed.
      let mid = await stripe.subscriptions.retrieve(sub.id);
      for (let i = 0; i < 10 && !mid.default_payment_method; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        mid = await stripe.subscriptions.retrieve(sub.id);
      }
      console.log(`after SetupIntent: sub default_pm=${mid.default_payment_method} pending_setup_intent=${mid.pending_setup_intent}`);
      assert(mid.default_payment_method, "SetupIntent card becomes the subscription default");
    }

    await advance(clock.id, now + 31 * DAY);
    await advance(clock.id, now + 31 * DAY + 3 * 3600); // let the invoice finalize + attempt (~1h after creation)
    const after = await stripe.subscriptions.retrieve(sub.id, { expand: ["latest_invoice"] });
    const inv = after.latest_invoice as Stripe.Invoice | null;
    const invoices = await stripe.invoices.list({ subscription: sub.id });
    const charged = invoices.data.filter((i) => i.amount_due > 0);
    console.log(`after trial: status=${after.status} ended_at=${after.ended_at} trial_end=${after.trial_end} invoices>$0=${charged.length} latest=${inv?.status}/${inv?.amount_due}`);

    if (addCard) {
      assert(after.status === "active" && inv?.status === "paid" && inv.amount_due === 3500, "card-added trial converts and pays $35");
    } else {
      assert(after.status === "canceled", `no-card trial ends canceled (got ${after.status})`);
      assert(charged.length === 0, "no $35 invoice is issued");
      const failed = await stripe.events.list({ type: "invoice.payment_failed", created: { gte: now - 60 } });
      assert(!failed.data.some((e) => (e.data.object as Stripe.Invoice).parent?.subscription_details?.subscription === sub.id), "no payment_failed → no dunning");
      assert(
        isTrialLapse({ stripeStatus: after.status, trialEnd: after.trial_end, endedAt: after.ended_at, paidInvoices: 0 }),
        "Hub reads it as a trial lapse → expired",
      );
    }
  } finally {
    await stripe.testHelpers.testClocks.del(clock.id).catch(() => {});
  }
}

async function main() {
  await scenario("A. trial, no card ever added", false);
  await scenario("B. trial, card added on day 10", true);
  console.log("\n✅ TRIAL SPIKE: ALL PASSED");
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
