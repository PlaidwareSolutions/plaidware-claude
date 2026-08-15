import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { isProd } from "@/env";
import { db } from "@/db";
import { getStripe } from "@/lib/stripe";
import { stripeEvents } from "@/modules/billing/schema";
import {
  applyInvoiceEvent,
  applySubscriptionEvent,
  claimStripeEvent,
  sendTrialEndingReminder,
  sendUpcomingRenewalReminder,
} from "@/modules/billing/service";

export const dynamic = "force-dynamic";

/**
 * Stripe event sink. Signature verification FAILS CLOSED in production
 * (the old app accepted unsigned JSON when the secret was missing — PRD §2).
 */
export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    try {
      event = getStripe().webhooks.constructEvent(payload, signature ?? "", secret);
    } catch {
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else if (!isProd) {
    // Local development without `stripe listen` — accept unsigned fixtures.
    event = JSON.parse(payload) as Stripe.Event;
  } else {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET missing in production");
    return Response.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const fresh = await claimStripeEvent(event.id, event.type);
  if (!fresh) return Response.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        await applyInvoiceEvent(event.data.object as Stripe.Invoice, event.type);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscriptionEvent(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.trial_will_end":
        await sendTrialEndingReminder(event.data.object as Stripe.Subscription);
        break;
      case "invoice.upcoming":
        await sendUpcomingRenewalReminder(event.data.object as Stripe.Invoice);
        break;
      default:
        break; // ignored event types
    }
    return Response.json({ received: true });
  } catch (e) {
    console.error(`[webhook] ${event.type} failed:`, e);
    // Release the dedupe claim so Stripe's retry (same event id) can re-run.
    try {
      await db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    } catch {
      /* claim release is best-effort */
    }
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
