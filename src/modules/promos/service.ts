import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { getStripe } from "../../lib/stripe";
import { promoAssignments, promoCodes, promoRedemptions } from "./schema";
import {
  computeDiscount,
  needsMintedCoupon,
  pickAutoApply,
  redemptionComplete,
  validatePromo,
  type Discount,
  type PromoLike,
  type SelectionItem,
} from "./logic";

// ---------------------------------------------------------------------------
// Stripe catalog mirroring
// ---------------------------------------------------------------------------

/** Create/refresh the reusable Stripe Coupon (+ Promotion Code) for a clean promo. */
export async function syncPromoToStripe(promoId: string): Promise<void> {
  const promo = await db.query.promoCodes.findFirst({ where: eq(promoCodes.id, promoId) });
  if (!promo) throw new Error("Promo not found");
  if (needsMintedCoupon(promo)) {
    throw new Error(
      "Component-scoped and fixed-price promos mint their coupon at checkout — no catalog sync needed.",
    );
  }
  const stripe = getStripe();

  const durationParams: Stripe.CouponCreateParams =
    promo.duration === "forever"
      ? { duration: "forever" }
      : promo.duration === "repeating"
        ? { duration: "repeating", duration_in_months: promo.durationMonths ?? 1 }
        : { duration: "once" };

  let couponParams: Stripe.CouponCreateParams;
  if (promo.kind === "percent_off") {
    couponParams = { ...durationParams, percent_off: promo.percentOff ?? 0 };
  } else if (promo.kind === "amount_off") {
    couponParams = { ...durationParams, amount_off: promo.amountCents ?? 0, currency: "usd" };
  } else {
    // free_periods → 100% off repeating N months
    couponParams = {
      duration: "repeating",
      duration_in_months: promo.freePeriods ?? 1,
      percent_off: 100,
    };
  }

  const coupon = await stripe.coupons.create({
    ...couponParams,
    name: promo.code,
    metadata: { promo_code_id: promo.id },
  });
  const promotionCode = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code: promo.code,
    metadata: { promo_code_id: promo.id },
  });
  await db
    .update(promoCodes)
    .set({ stripeCouponId: coupon.id, stripePromotionCodeId: promotionCode.id })
    .where(eq(promoCodes.id, promo.id));
}

// ---------------------------------------------------------------------------
// Checkout resolution (called from billing/service.createCheckout)
// ---------------------------------------------------------------------------

export type ResolvedPromo = {
  promo: PromoLike;
  discount: Discount;
  source: "manual" | "auto";
  /** Coupon to attach at checkout; minted=true means delete it on failure. */
  stripeCouponId: string;
  minted: boolean;
};

async function isAssigned(promoId: string, tenantId: string): Promise<boolean> {
  const row = await db.query.promoAssignments.findFirst({
    where: and(eq(promoAssignments.promoCodeId, promoId), eq(promoAssignments.tenantId, tenantId)),
  });
  return Boolean(row);
}

const REJECTION_TEXT: Record<string, string> = {
  inactive: "That code is no longer active.",
  expired: "That code has expired.",
  max_redemptions: "That code has reached its redemption limit.",
  not_assigned: "That code isn't available for your account.",
  wrong_product: "That code doesn't apply to this product.",
  not_applicable: "That code doesn't apply to your selection.",
};

/**
 * Resolve which promo (if any) applies to this checkout: an explicitly typed
 * code wins; otherwise the single best auto-apply candidate. Never stacks.
 */
export async function resolveCheckoutPromo(opts: {
  tenantId: string;
  productId: string;
  items: SelectionItem[];
  code?: string | null;
}): Promise<ResolvedPromo | null> {
  const stripe = getStripe();

  if (opts.code) {
    const promo = await db.query.promoCodes.findFirst({
      where: eq(promoCodes.code, opts.code.trim()),
    });
    if (!promo) throw new Error("That code doesn't exist.");
    const rejection = validatePromo(promo, {
      productId: opts.productId,
      tenantAssigned: await isAssigned(promo.id, opts.tenantId),
    });
    if (rejection) throw new Error(REJECTION_TEXT[rejection]);
    const discount = computeDiscount(promo, opts.items);
    if (!discount) throw new Error(REJECTION_TEXT.not_applicable);
    return await attachCoupon(stripe, promo, discount, "manual");
  }

  // Auto-apply: every active auto promo that survives validation.
  const autos = await db.query.promoCodes.findMany({
    where: and(eq(promoCodes.autoApply, true), eq(promoCodes.isActive, true)),
  });
  const candidates: { promo: PromoLike; discount: Discount }[] = [];
  for (const promo of autos) {
    const rejection = validatePromo(promo, {
      productId: opts.productId,
      tenantAssigned: promo.isPublic ? true : await isAssigned(promo.id, opts.tenantId),
    });
    if (rejection) continue;
    const discount = computeDiscount(promo, opts.items);
    if (discount) candidates.push({ promo, discount });
  }
  const best = pickAutoApply(candidates);
  if (!best) return null;
  return attachCoupon(stripe, best.promo, best.discount, "auto");
}

async function attachCoupon(
  stripe: Stripe,
  promo: PromoLike & { stripeCouponId?: string | null },
  discount: Discount,
  source: "manual" | "auto",
): Promise<ResolvedPromo> {
  if (!needsMintedCoupon(promo)) {
    let couponId = promo.stripeCouponId ?? null;
    if (!couponId) {
      await syncPromoToStripe(promo.id);
      const refreshed = await db.query.promoCodes.findFirst({ where: eq(promoCodes.id, promo.id) });
      couponId = refreshed?.stripeCouponId ?? null;
    }
    if (!couponId) throw new Error("Promo isn't synced to Stripe yet.");
    return { promo, discount, source, stripeCouponId: couponId, minted: false };
  }
  // Order-relative discount: mint a single-use coupon worth the computed
  // first-invoice savings. Deleted on any checkout failure; a daily sweep
  // catches leaks (PRD §4.6).
  const coupon = await stripe.coupons.create({
    duration: "once",
    amount_off: discount.firstInvoiceCents,
    currency: "usd",
    max_redemptions: 1,
    name: `${promo.code} (checkout)`,
    metadata: { promo_code_id: promo.id, plaidware_minted: "1" },
  });
  return { promo, discount, source, stripeCouponId: coupon.id, minted: true };
}

export async function deleteMintedCoupon(resolved: ResolvedPromo | null): Promise<void> {
  if (!resolved?.minted) return;
  await getStripe()
    .coupons.del(resolved.stripeCouponId)
    .catch((e) => console.error("[promo] minted-coupon cleanup failed:", e));
}

/** Record the redemption at checkout success. */
export async function recordRedemption(opts: {
  resolved: ResolvedPromo;
  tenantId: string;
  subscriptionId: string;
  userId: string | null;
}): Promise<void> {
  await db.insert(promoRedemptions).values({
    promoCodeId: opts.resolved.promo.id,
    tenantId: opts.tenantId,
    subscriptionId: opts.subscriptionId,
    userId: opts.userId,
    source: opts.resolved.source,
    stripeCouponId: opts.resolved.stripeCouponId,
  });
  await db
    .update(promoCodes)
    .set({ timesRedeemed: sql`${promoCodes.timesRedeemed} + 1` })
    .where(eq(promoCodes.id, opts.resolved.promo.id));
}

// ---------------------------------------------------------------------------
// Webhook reconciliation — actual dollars saved, from Stripe invoice data
// ---------------------------------------------------------------------------

export async function reconcileInvoiceDiscounts(
  invoice: Stripe.Invoice,
  localSubscriptionId: string | null,
): Promise<void> {
  let totals = invoice.total_discount_amounts ?? [];
  if (totals.length === 0 || !localSubscriptionId) return;

  // Webhook payloads carry discount IDs, not objects — re-fetch expanded.
  if (totals.some((t) => typeof t.discount === "string")) {
    const expanded = await getStripe().invoices.retrieve(invoice.id!, {
      expand: ["total_discount_amounts.discount"],
    });
    totals = expanded.total_discount_amounts ?? [];
  }

  for (const t of totals) {
    if (t.amount <= 0) continue;
    const discountObj =
      typeof t.discount === "string"
        ? null
        : (t.discount as Stripe.Discount | null);
    const sourceCoupon = discountObj?.source?.coupon ?? null;
    const couponId =
      sourceCoupon == null
        ? null
        : typeof sourceCoupon === "string"
          ? sourceCoupon
          : sourceCoupon.id;
    if (!couponId) continue;

    const redemption = await db.query.promoRedemptions.findFirst({
      where: and(
        eq(promoRedemptions.subscriptionId, localSubscriptionId),
        eq(promoRedemptions.stripeCouponId, couponId),
      ),
    });
    if (!redemption) continue;

    const applied = redemption.invoicesApplied + 1;
    const promo = await db.query.promoCodes.findFirst({
      where: eq(promoCodes.id, redemption.promoCodeId),
    });
    await db
      .update(promoRedemptions)
      .set({
        savingsCents: redemption.savingsCents + t.amount,
        invoicesApplied: applied,
        lastAppliedAt: new Date(),
        status: promo && redemptionComplete(promo, applied) ? "completed" : redemption.status,
      })
      .where(eq(promoRedemptions.id, redemption.id));
  }
}

// ---------------------------------------------------------------------------
// Orphan-coupon sweep (worker job) — deletes minted coupons that never redeemed
// ---------------------------------------------------------------------------

export async function sweepOrphanCoupons(): Promise<{ scanned: number; deleted: number }> {
  const stripe = getStripe();
  let scanned = 0;
  let deleted = 0;
  const cutoff = Math.floor(Date.now() / 1000) - 3600; // leave in-flight checkouts alone

  for await (const coupon of stripe.coupons.list({ limit: 100 })) {
    scanned++;
    if (coupon.metadata?.plaidware_minted !== "1") continue;
    if (coupon.times_redeemed > 0) continue;
    if (coupon.created > cutoff) continue;
    const referenced = await db.query.promoRedemptions.findFirst({
      where: eq(promoRedemptions.stripeCouponId, coupon.id),
    });
    if (referenced) continue;
    await stripe.coupons.del(coupon.id).catch(() => {});
    deleted++;
    if (deleted >= 200) break; // per-run cap, matching the legacy sweep
  }
  return { scanned, deleted };
}
