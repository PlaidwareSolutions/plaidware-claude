/**
 * Pure promo math — validation, discount computation, auto-apply scoring,
 * completion rules. Ported from the legacy engine (server/promos.ts) and
 * unit-tested as the spec. No Stripe, no DB.
 */

export type PromoLike = {
  id: string;
  code: string;
  kind: "percent_off" | "amount_off" | "fixed_price" | "free_periods";
  percentOff: number | null;
  amountCents: number | null;
  freePeriods: number | null;
  duration: "once" | "repeating" | "forever";
  durationMonths: number | null;
  productId: string | null;
  componentId: string | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  redeemBy: Date | null;
  isActive: boolean;
  isPublic: boolean;
  autoApply: boolean;
  createdAt: Date;
};

export type SelectionItem = {
  componentId: string;
  kind: string; // one_time | recurring | legacy recurring_monthly/yearly
  amountCents: number;
};

/** Scored over 12 periods so "forever" doesn't always trivially win. */
export const FOREVER_HORIZON_PERIODS = 12;

export type PromoRejection =
  | "inactive"
  | "expired"
  | "max_redemptions"
  | "not_assigned"
  | "wrong_product"
  | "not_applicable";

export function validatePromo(
  promo: PromoLike,
  ctx: { productId: string; tenantAssigned: boolean; now?: Date },
): PromoRejection | null {
  const now = ctx.now ?? new Date();
  if (!promo.isActive) return "inactive";
  if (promo.redeemBy && promo.redeemBy < now) return "expired";
  if (promo.maxRedemptions != null && promo.timesRedeemed >= promo.maxRedemptions) {
    return "max_redemptions";
  }
  if (!promo.isPublic && !ctx.tenantAssigned) return "not_assigned";
  if (promo.productId && promo.productId !== ctx.productId) return "wrong_product";
  return null;
}

export type Discount = {
  /** Savings on the first invoice (one-time + first period of recurring). */
  firstInvoiceCents: number;
  /** Savings on each subsequent recurring period the discount still applies. */
  perPeriodCents: number;
  /** How many recurring periods the discount lasts after the first (Infinity = forever). */
  remainingPeriods: number;
  description: string;
};

/** Compute what a promo is worth against a concrete selection. */
export function computeDiscount(promo: PromoLike, items: SelectionItem[]): Discount | null {
  const scoped = promo.componentId
    ? items.filter((i) => i.componentId === promo.componentId)
    : items;
  if (scoped.length === 0) return null;

  const scopedFirstTotal = scoped.reduce((s, i) => s + i.amountCents, 0);
  const scopedRecurring = scoped
    .filter((i) => i.kind === "recurring" || i.kind === "recurring_monthly" || i.kind === "recurring_yearly")
    .reduce((s, i) => s + i.amountCents, 0);

  const periods =
    promo.duration === "once"
      ? 0
      : promo.duration === "forever"
        ? Infinity
        : Math.max((promo.durationMonths ?? 1) - 1, 0);

  switch (promo.kind) {
    case "percent_off": {
      const pct = promo.percentOff ?? 0;
      const first = Math.round((scopedFirstTotal * pct) / 100);
      const perPeriod = Math.round((scopedRecurring * pct) / 100);
      if (first === 0 && perPeriod === 0) return null;
      return {
        firstInvoiceCents: first,
        perPeriodCents: perPeriod,
        remainingPeriods: periods,
        description: `${pct}% off${promo.componentId ? " (selected item)" : ""}${durationText(promo)}`,
      };
    }
    case "amount_off": {
      const amt = promo.amountCents ?? 0;
      const first = Math.min(amt, scopedFirstTotal);
      const perPeriod = Math.min(amt, scopedRecurring);
      if (first === 0) return null;
      return {
        firstInvoiceCents: first,
        perPeriodCents: periods > 0 ? perPeriod : 0,
        remainingPeriods: periods,
        description: `$${(amt / 100).toFixed(2)} off${durationText(promo)}`,
      };
    }
    case "fixed_price": {
      // Order-relative: pay `amountCents` for the scoped selection's first
      // invoice instead of its full total. Always a one-time discount.
      const target = promo.amountCents ?? 0;
      const first = Math.max(scopedFirstTotal - target, 0);
      if (first === 0) return null;
      return {
        firstInvoiceCents: first,
        perPeriodCents: 0,
        remainingPeriods: 0,
        description: `Pay $${(target / 100).toFixed(2)} up front instead of $${(scopedFirstTotal / 100).toFixed(2)}`,
      };
    }
    case "free_periods": {
      const n = promo.freePeriods ?? 0;
      if (scopedRecurring === 0 || n === 0) return null;
      return {
        firstInvoiceCents: scopedRecurring, // first period free
        perPeriodCents: scopedRecurring,
        remainingPeriods: n - 1,
        description: `${n} ${n === 1 ? "period" : "periods"} free`,
      };
    }
  }
}

function durationText(promo: PromoLike): string {
  if (promo.duration === "forever") return ", forever";
  if (promo.duration === "repeating") return ` for ${promo.durationMonths} months`;
  return "";
}

/** Total savings over the promo's full life (forever capped at the horizon). */
export function totalSavingsCents(d: Discount): number {
  const periods = d.remainingPeriods === Infinity ? FOREVER_HORIZON_PERIODS - 1 : d.remainingPeriods;
  return d.firstInvoiceCents + d.perPeriodCents * periods;
}

/**
 * Auto-apply picks the SINGLE best candidate: highest lifetime savings,
 * tie-broken by immediate savings, then by newest. Promos never stack.
 */
export function pickAutoApply(
  candidates: { promo: PromoLike; discount: Discount }[],
): { promo: PromoLike; discount: Discount } | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const total = totalSavingsCents(b.discount) - totalSavingsCents(a.discount);
    if (total !== 0) return total;
    const first = b.discount.firstInvoiceCents - a.discount.firstInvoiceCents;
    if (first !== 0) return first;
    return b.promo.createdAt.getTime() - a.promo.createdAt.getTime();
  })[0];
}

/** Redemption completion (PRD §4.6): has the discount exhausted its life? */
export function redemptionComplete(promo: PromoLike, invoicesApplied: number): boolean {
  if (promo.duration === "once") return invoicesApplied >= 1;
  if (promo.duration === "repeating") return invoicesApplied >= (promo.durationMonths ?? 1);
  if (promo.kind === "free_periods") return invoicesApplied >= (promo.freePeriods ?? 1);
  return false; // forever
}

/** Clean promos map 1:1 to a reusable Stripe catalog coupon; component-scoped
 *  and fixed_price discounts are order-relative and need a per-checkout mint. */
export function needsMintedCoupon(promo: PromoLike): boolean {
  return promo.componentId != null || promo.kind === "fixed_price";
}
