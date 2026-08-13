import { describe, expect, it } from "vitest";
import {
  itemMrrCents,
  LIVE_SUBSCRIPTION_STATUSES,
  mapStripeInvoiceStatus,
  mapStripeSubscriptionStatus,
} from "./mappers";

describe("mapStripeSubscriptionStatus", () => {
  it("maps Stripe statuses to local lifecycle", () => {
    expect(mapStripeSubscriptionStatus("trialing")).toBe("trialing");
    expect(mapStripeSubscriptionStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("expired");
    expect(mapStripeSubscriptionStatus("paused")).toBe("suspended");
  });
});

describe("mapStripeInvoiceStatus", () => {
  it("payment_failed events always mark failed", () => {
    expect(mapStripeInvoiceStatus("open", "invoice.payment_failed")).toBe("failed");
  });
  it("maps stripe invoice statuses", () => {
    expect(mapStripeInvoiceStatus("paid", "invoice.paid")).toBe("paid");
    expect(mapStripeInvoiceStatus("void", "invoice.voided")).toBe("void");
    expect(mapStripeInvoiceStatus("uncollectible", "invoice.marked_uncollectible")).toBe("failed");
    expect(mapStripeInvoiceStatus("open", "invoice.finalized")).toBe("open");
    expect(mapStripeInvoiceStatus(null, "invoice.finalized")).toBe("open");
  });
});

describe("itemMrrCents", () => {
  it("normalizes to monthly cents", () => {
    expect(itemMrrCents("recurring_monthly", 19900)).toBe(19900);
    expect(itemMrrCents("recurring_yearly", 120000)).toBe(10000);
    expect(itemMrrCents("one_time", 450000)).toBe(0);
  });
});

describe("live statuses", () => {
  it("terminal states never hold the one-per-product slot", () => {
    expect(LIVE_SUBSCRIPTION_STATUSES).not.toContain("canceled");
    expect(LIVE_SUBSCRIPTION_STATUSES).not.toContain("expired");
    expect(LIVE_SUBSCRIPTION_STATUSES).toContain("trialing");
    expect(LIVE_SUBSCRIPTION_STATUSES).toContain("incomplete");
  });
});
