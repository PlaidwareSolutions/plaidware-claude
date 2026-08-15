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

/** Recurring in any spelling: new interval model or legacy kinds. */
export function isRecurringKind(kind: string): boolean {
  return kind === "recurring" || kind === "recurring_monthly" || kind === "recurring_yearly";
}

export type BillingInterval = { interval: "week" | "month" | "year"; intervalCount: number };

/** Normalize a component/item row (legacy kinds included) to its interval. */
export function resolveInterval(row: {
  kind: string;
  interval?: string | null;
  intervalCount?: number | null;
}): BillingInterval | null {
  if (!isRecurringKind(row.kind)) return null;
  if (row.interval === "week" || row.interval === "month" || row.interval === "year") {
    return { interval: row.interval, intervalCount: Math.max(row.intervalCount ?? 1, 1) };
  }
  if (row.kind === "recurring_monthly") return { interval: "month", intervalCount: 1 };
  if (row.kind === "recurring_yearly") return { interval: "year", intervalCount: 1 };
  return { interval: "month", intervalCount: 1 };
}

/** Monthly-recurring revenue contribution of one item, in cents. */
export function itemMrrCents(
  row: { kind: string; interval?: string | null; intervalCount?: number | null },
  amountCents: number,
): number {
  const iv = resolveInterval(row);
  if (!iv) return 0;
  const monthsPerPeriod =
    iv.interval === "week"
      ? (iv.intervalCount * 12) / 52
      : iv.interval === "month"
        ? iv.intervalCount
        : iv.intervalCount * 12;
  return Math.round(amountCents / monthsPerPeriod);
}

/** Human label for a billing frequency: "/mo", "/quarter", "/2 wk", "/yr"… */
export function intervalLabel(row: {
  kind: string;
  interval?: string | null;
  intervalCount?: number | null;
}): string {
  const iv = resolveInterval(row);
  if (!iv) return "";
  const { interval, intervalCount: n } = iv;
  if (interval === "month" && n === 1) return "/mo";
  if (interval === "month" && n === 3) return "/quarter";
  if (interval === "year" && n === 1) return "/yr";
  if (interval === "week" && n === 1) return "/wk";
  const unit = interval === "month" ? "mo" : interval === "year" ? "yr" : "wk";
  return `/${n} ${unit}`;
}
