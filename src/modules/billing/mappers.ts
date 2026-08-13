/** Pure mapping logic — unit-tested without Stripe or the DB. */

export type LocalSubscriptionStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "canceled"
  | "expired";

export function mapStripeSubscriptionStatus(s: string): LocalSubscriptionStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "expired";
    case "paused":
      return "suspended";
    default:
      return "incomplete";
  }
}

export type LocalInvoiceStatus = "draft" | "open" | "paid" | "failed" | "void";

export function mapStripeInvoiceStatus(
  stripeStatus: string | null,
  eventType: string,
): LocalInvoiceStatus {
  if (eventType === "invoice.payment_failed") return "failed";
  switch (stripeStatus) {
    case "paid":
      return "paid";
    case "void":
      return "void";
    case "uncollectible":
      return "failed";
    case "draft":
      return "draft";
    default:
      return "open";
  }
}

/** A subscription row still holding the one-per-product slot (PRD §4.4). */
export const LIVE_SUBSCRIPTION_STATUSES: LocalSubscriptionStatus[] = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "suspended",
];

/** Monthly-recurring revenue contribution of one item, in cents. */
export function itemMrrCents(kind: string, amountCents: number): number {
  if (kind === "recurring_monthly") return amountCents;
  if (kind === "recurring_yearly") return Math.round(amountCents / 12);
  return 0;
}
