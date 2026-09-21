import { describe, expect, it } from "vitest";
import { buildStartPlan, type StartComponent, type StartItemInput } from "./start-logic";

const comp = (over: Partial<StartComponent> & { id: string }): StartComponent => ({
  name: over.id,
  kind: "recurring",
  role: "addon",
  interval: "month",
  intervalCount: 1,
  isRequired: false,
  isActive: true,
  listCents: 1000,
  ...over,
});

// Drivorata as negotiated for All Ages Driving School.
const drivorata = [
  comp({ id: "onboarding", name: "School Onboarding", kind: "one_time", interval: null, isRequired: true, listCents: 120000 }),
  comp({ id: "sub", name: "Subscription", role: "base", isRequired: true, listCents: 12900 }),
  comp({ id: "extra", name: "Extra Location", listCents: 5900 }),
  comp({ id: "maint", name: "Maintenance", interval: "year", listCents: 12000 }),
];
const deal: StartItemInput[] = [
  { componentId: "sub", amountCents: 4000, quantity: 1 },
  { componentId: "extra", amountCents: 100, quantity: 2 },
  { componentId: "maint", amountCents: 100, quantity: 1 },
  { componentId: "onboarding", amountCents: 50000, quantity: 1, settlement: { mode: "offline", payment: { method: "cash", reference: "cash 9/20" } } },
];
const NOW = new Date("2026-09-20T15:00:00Z");

describe("buildStartPlan", () => {
  it("splits the deal into Stripe lines, offline lines and totals", () => {
    const r = buildStartPlan({ items: deal, components: drivorata, now: NOW, timeZone: "UTC" });
    if (!r.ok) throw new Error(r.errors.join(", "));
    const { plan } = r;
    expect(plan.stripeRecurring.map((l) => [l.name, l.lineCents, l.quantity])).toEqual([
      ["Subscription", 4000, 1],
      ["Extra Location", 200, 2],
      ["Maintenance", 100, 1],
    ]);
    expect(plan.stripeOneTime).toEqual([]);
    expect(plan.offlineOneTime.map((l) => l.name)).toEqual(["School Onboarding"]);
    expect(plan.needsStripeSubscription).toBe(true);
    expect(plan.backdate).toBeNull();
    expect(plan.totals).toEqual({
      firstInvoiceCents: 4300,
      offlineCents: 50000,
      waivedListCents: 0,
      monthlyCents: 4200,
      yearlyCents: 100,
      trialApplied: false,
    });
  });

  it("backdates to July: one line per month per monthly item, yearly prorated to the anchor", () => {
    const r = buildStartPlan({ items: deal, components: drivorata, now: NOW, timeZone: "UTC", billFromMonth: "2026-07" });
    if (!r.ok) throw new Error(r.errors.join(", "));
    const b = r.plan.backdate!;
    expect(b.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(b.startAt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(b.anchorAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(b.lines.map((l) => [l.name, l.cents, l.prorated])).toEqual([
      ["Subscription — July 2026", 4000, false],
      ["Subscription — August 2026", 4000, false],
      ["Subscription — September 2026", 4000, false],
      ["Extra Location ×2 — July 2026", 200, false],
      ["Extra Location ×2 — August 2026", 200, false],
      ["Extra Location ×2 — September 2026", 200, false],
      ["Maintenance — Jul 1 – Sep 30, 2026 (prorated)", 25, true], // 92/365 of $1.00
    ]);
    expect(b.lines[1].periodStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(b.lines[1].periodEnd.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(b.cents).toBe(12625);
    expect(r.plan.totals.firstInvoiceCents).toBe(12625);
    expect(r.plan.totals.monthlyCents).toBe(4200);
    expect(r.plan.totals.trialApplied).toBe(false);
  });

  it("backdating to the current month bills it in full and anchors next month; a trial never applies", () => {
    const r = buildStartPlan({ items: deal, components: drivorata, now: NOW, timeZone: "UTC", billFromMonth: "2026-09", trialDays: 14 });
    if (!r.ok) throw new Error(r.errors.join(", "));
    expect(r.plan.backdate!.months).toEqual(["2026-09"]);
    expect(r.plan.backdate!.cents).toBe(4200 + Math.round((100 * 30) / 365));
    expect(r.plan.totals.trialApplied).toBe(false);
  });

  it("uses the display zone for month boundaries", () => {
    const r = buildStartPlan({ items: deal, components: drivorata, now: NOW, timeZone: "America/Chicago", billFromMonth: "2026-08" });
    if (!r.ok) throw new Error(r.errors.join(", "));
    expect(r.plan.backdate!.startAt.toISOString()).toBe("2026-08-01T05:00:00.000Z");
    expect(r.plan.backdate!.anchorAt.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  it("rejects future or too-old bill-from months and backdating without recurring items", () => {
    const future = buildStartPlan({ items: deal, components: drivorata, now: NOW, timeZone: "UTC", billFromMonth: "2026-10" });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors[0]).toMatch(/future/);
    const old = buildStartPlan({ items: deal, components: drivorata, now: NOW, timeZone: "UTC", billFromMonth: "2024-01" });
    if (!old.ok) expect(old.errors[0]).toMatch(/24 months/);
    const oneTimeOnly = buildStartPlan({
      items: [{ componentId: "build", amountCents: 5000, quantity: 1 }],
      components: [comp({ id: "build", kind: "one_time", interval: null, listCents: 5000 })],
      now: NOW,
      timeZone: "UTC",
      billFromMonth: "2026-08",
    });
    if (!oneTimeOnly.ok) expect(oneTimeOnly.errors[0]).toMatch(/recurring/);
    expect(oneTimeOnly.ok).toBe(false);
  });

  it("trial skips the recurring first period unless skipped", () => {
    const withTrial = buildStartPlan({ items: deal, components: drivorata, now: NOW, trialDays: 14 });
    if (!withTrial.ok) throw new Error(withTrial.errors.join(", "));
    expect(withTrial.plan.totals.trialApplied).toBe(true);
    expect(withTrial.plan.totals.firstInvoiceCents).toBe(0);
    const skipped = buildStartPlan({ items: deal, components: drivorata, now: NOW, trialDays: 14, skipTrial: true });
    if (!skipped.ok) throw new Error(skipped.errors.join(", "));
    expect(skipped.plan.totals.firstInvoiceCents).toBe(4300);
  });

  it("waive zeroes the price and remembers the list value; invoice-settled one-time rides the first invoice", () => {
    const items: StartItemInput[] = [
      { componentId: "sub", amountCents: 4000, quantity: 1 },
      { componentId: "onboarding", amountCents: 999, quantity: 1, settlement: { mode: "waive" } },
    ];
    const r = buildStartPlan({ items, components: drivorata, now: NOW });
    if (!r.ok) throw new Error(r.errors.join(", "));
    expect(r.plan.stripeOneTime[0]).toMatchObject({ name: "School Onboarding", amountCents: 0, lineCents: 0 });
    expect(r.plan.totals.waivedListCents).toBe(120000);
    expect(r.plan.totals.firstInvoiceCents).toBe(4000);
    const invoiced = buildStartPlan({
      items: [items[0], { componentId: "onboarding", amountCents: 50000, quantity: 1 }],
      components: drivorata,
      now: NOW,
    });
    if (!invoiced.ok) throw new Error(invoiced.errors.join(", "));
    expect(invoiced.plan.totals.firstInvoiceCents).toBe(54000);
  });

  it("forces quantity 1 on the main charge and one-time work", () => {
    const r = buildStartPlan({
      items: [
        { componentId: "sub", amountCents: 4000, quantity: 3 },
        { componentId: "onboarding", amountCents: 50000, quantity: 2 },
      ],
      components: drivorata,
      now: NOW,
    });
    if (!r.ok) throw new Error(r.errors.join(", "));
    expect(r.plan.lines.map((l) => l.quantity)).toEqual([1, 1]);
  });

  it("collects validation errors", () => {
    const r = buildStartPlan({
      items: [
        { componentId: "extra", amountCents: 100, quantity: 0 },
        { componentId: "extra", amountCents: 100, quantity: 1 },
        { componentId: "maint", amountCents: 100, quantity: 1, settlement: { mode: "waive" } },
        { componentId: "onboarding", amountCents: 0, quantity: 1, settlement: { mode: "offline", payment: { method: "cash" } } },
        { componentId: "ghost", amountCents: 1, quantity: 1 },
      ],
      components: drivorata,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/quantity must be 1/),
        "Extra Location is listed twice",
        expect.stringMatching(/only one-time items/),
        expect.stringMatching(/use Waive/),
        "Unknown or inactive component",
        "Subscription (the main charge) must be included",
      ]),
    );
  });

  it("all-offline one-time-only needs no Stripe subscription; all-waived is refused", () => {
    const build = comp({ id: "build", kind: "one_time", interval: null, listCents: 5000 });
    const r = buildStartPlan({
      items: [{ componentId: "build", amountCents: 5000, quantity: 1, settlement: { mode: "offline", payment: { method: "check", reference: "1001" } } }],
      components: [build],
      now: NOW,
    });
    if (!r.ok) throw new Error(r.errors.join(", "));
    expect(r.plan.needsStripeSubscription).toBe(false);
    expect(r.plan.totals).toMatchObject({ firstInvoiceCents: 0, offlineCents: 5000 });
    const waived = buildStartPlan({ items: [{ componentId: "build", amountCents: 0, quantity: 1, settlement: { mode: "waive" } }], components: [build], now: NOW });
    expect(waived.ok).toBe(false);
  });
});
