import { describe, expect, it } from "vitest";
import { summarizeClientBilling } from "./client-summary";

const sub = (over: Partial<Parameters<typeof summarizeClientBilling>[0]["subscriptions"][number]> = {}) => ({
  id: "s1",
  productName: "Company Website",
  status: "active",
  monthlyCents: 3500,
  currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("summarizeClientBilling", () => {
  it("rolls up MRR, outstanding, lifetime and past-due", () => {
    const r = summarizeClientBilling({
      subscriptions: [sub(), sub({ id: "s2", status: "canceled", monthlyCents: 999 })],
      invoices: [
        { status: "paid", amountDueCents: 3500, amountPaidCents: 3500, pastDue: false },
        { status: "open", amountDueCents: 7900, amountPaidCents: 2000, pastDue: true },
        { status: "void", amountDueCents: 100, amountPaidCents: 0, pastDue: false },
      ],
      automation: [],
    });
    expect(r.liveCount).toBe(1);
    expect(r.mrrCents).toBe(3500);
    expect(r.outstandingCents).toBe(5900);
    expect(r.pastDueCount).toBe(1);
    expect(r.lifetimePaidCents).toBe(5500);
  });

  it("flags subscriptions that will only email a payment link", () => {
    const r = summarizeClientBilling({
      subscriptions: [sub(), sub({ id: "s2", productName: "SEO" })],
      invoices: [],
      automation: [
        { subscriptionId: "s1", error: null, collectionMethod: "send_invoice", cardOnFile: false, nextChargeAt: "2026-09-20T00:00:00.000Z", monthlyCents: 3500 },
        { subscriptionId: "s2", error: null, collectionMethod: "charge_automatically", cardOnFile: true, nextChargeAt: "2026-09-25T00:00:00.000Z", monthlyCents: 1000 },
      ],
    });
    expect(r.wontAutoCollect.map((w) => w.subscriptionId)).toEqual(["s1"]);
    expect(r.wontAutoCollect[0].reason).toMatch(/payment link/);
    expect(r.nextCharge).toMatchObject({ subscriptionId: "s1", amountCents: 3500, autoCollects: false });
  });

  it("falls back to local period end when Stripe is unreadable", () => {
    const r = summarizeClientBilling({
      subscriptions: [sub()],
      invoices: [],
      automation: [{ subscriptionId: "s1", error: "boom", collectionMethod: null, cardOnFile: false, nextChargeAt: null, monthlyCents: 0 }],
    });
    expect(r.wontAutoCollect).toEqual([]);
    expect(r.nextCharge?.at).toBe("2026-10-01T00:00:00.000Z");
    expect(r.nextCharge?.amountCents).toBe(3500);
  });
});
