import { describe, expect, it } from "vitest";
import {
  computeDiscount,
  needsMintedCoupon,
  pickAutoApply,
  redemptionComplete,
  totalSavingsCents,
  validatePromo,
  type PromoLike,
  type SelectionItem,
} from "./logic";

function promo(over: Partial<PromoLike>): PromoLike {
  return {
    id: "p1",
    code: "TEST",
    kind: "percent_off",
    percentOff: 25,
    amountCents: null,
    freePeriods: null,
    duration: "once",
    durationMonths: null,
    productId: null,
    componentId: null,
    maxRedemptions: null,
    timesRedeemed: 0,
    redeemBy: null,
    isActive: true,
    isPublic: true,
    autoApply: false,
    createdAt: new Date("2026-01-01"),
    ...over,
  };
}

// Buildorata-shaped selection: $2,500 one-time + $199/mo
const items: SelectionItem[] = [
  { componentId: "c-onetime", kind: "one_time", amountCents: 250000 },
  { componentId: "c-monthly", kind: "recurring_monthly", amountCents: 19900 },
];

describe("validatePromo", () => {
  it("enforces lifecycle and assignment", () => {
    expect(validatePromo(promo({ isActive: false }), { productId: "x", tenantAssigned: false })).toBe("inactive");
    expect(validatePromo(promo({ redeemBy: new Date("2020-01-01") }), { productId: "x", tenantAssigned: false })).toBe("expired");
    expect(validatePromo(promo({ maxRedemptions: 2, timesRedeemed: 2 }), { productId: "x", tenantAssigned: false })).toBe("max_redemptions");
    expect(validatePromo(promo({ isPublic: false }), { productId: "x", tenantAssigned: false })).toBe("not_assigned");
    expect(validatePromo(promo({ isPublic: false }), { productId: "x", tenantAssigned: true })).toBeNull();
    expect(validatePromo(promo({ productId: "other" }), { productId: "x", tenantAssigned: false })).toBe("wrong_product");
    expect(validatePromo(promo({}), { productId: "x", tenantAssigned: false })).toBeNull();
  });
});

describe("computeDiscount", () => {
  it("percent_off once hits the whole first invoice", () => {
    const d = computeDiscount(promo({}), items)!;
    expect(d.firstInvoiceCents).toBe(67475); // 25% of $2,699
    expect(d.remainingPeriods).toBe(0);
  });

  it("percent_off forever keeps discounting recurring", () => {
    const d = computeDiscount(promo({ duration: "forever" }), items)!;
    expect(d.perPeriodCents).toBe(4975); // 25% of $199
    expect(d.remainingPeriods).toBe(Infinity);
    expect(totalSavingsCents(d)).toBe(67475 + 4975 * 11); // 12-period horizon
  });

  it("component-scoped percent only touches that line", () => {
    const d = computeDiscount(promo({ componentId: "c-monthly" }), items)!;
    expect(d.firstInvoiceCents).toBe(4975);
  });

  it("amount_off caps at the order total", () => {
    const d = computeDiscount(promo({ kind: "amount_off", percentOff: null, amountCents: 999900 }), items)!;
    expect(d.firstInvoiceCents).toBe(269900);
  });

  it("fixed_price charges the target instead of the total", () => {
    const d = computeDiscount(
      promo({ kind: "fixed_price", percentOff: null, amountCents: 200000 }),
      items,
    )!;
    expect(d.firstInvoiceCents).toBe(69900); // 2699 - 2000
    expect(d.remainingPeriods).toBe(0);
  });

  it("free_periods needs recurring items", () => {
    const d = computeDiscount(promo({ kind: "free_periods", percentOff: null, freePeriods: 3 }), items)!;
    expect(d.firstInvoiceCents).toBe(19900);
    expect(d.remainingPeriods).toBe(2);
    const none = computeDiscount(
      promo({ kind: "free_periods", percentOff: null, freePeriods: 3 }),
      [items[0]],
    );
    expect(none).toBeNull();
  });
});

describe("pickAutoApply", () => {
  it("picks highest lifetime savings, not highest immediate", () => {
    const bigOnce = promo({ id: "a", code: "ONCE50", percentOff: 50 });
    const foreverSmall = promo({ id: "b", code: "FOREVER25", duration: "forever" });
    const picked = pickAutoApply([
      { promo: bigOnce, discount: computeDiscount(bigOnce, items)! },
      { promo: foreverSmall, discount: computeDiscount(foreverSmall, items)! },
    ])!;
    // ONCE50 = 134,950 lifetime; FOREVER25 = 67,475 + 11×4,975 = 122,200
    expect(picked.promo.code).toBe("ONCE50");
  });

  it("tie-breaks by recency", () => {
    const a = promo({ id: "a", code: "OLD", createdAt: new Date("2026-01-01") });
    const b = promo({ id: "b", code: "NEW", createdAt: new Date("2026-06-01") });
    const picked = pickAutoApply([
      { promo: a, discount: computeDiscount(a, items)! },
      { promo: b, discount: computeDiscount(b, items)! },
    ])!;
    expect(picked.promo.code).toBe("NEW");
  });
});

describe("redemptionComplete", () => {
  it("follows duration semantics", () => {
    expect(redemptionComplete(promo({}), 1)).toBe(true);
    expect(redemptionComplete(promo({ duration: "repeating", durationMonths: 3 }), 2)).toBe(false);
    expect(redemptionComplete(promo({ duration: "repeating", durationMonths: 3 }), 3)).toBe(true);
    expect(redemptionComplete(promo({ kind: "free_periods", freePeriods: 2, duration: "repeating", durationMonths: 2 }), 2)).toBe(true);
    expect(redemptionComplete(promo({ duration: "forever" }), 99)).toBe(false);
  });
});

describe("needsMintedCoupon", () => {
  it("component scope and fixed_price mint per-checkout", () => {
    expect(needsMintedCoupon(promo({}))).toBe(false);
    expect(needsMintedCoupon(promo({ componentId: "c" }))).toBe(true);
    expect(needsMintedCoupon(promo({ kind: "fixed_price" }))).toBe(true);
  });
});
