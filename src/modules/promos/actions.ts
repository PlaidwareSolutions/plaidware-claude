"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { getStripe, stripeConfigured } from "../../lib/stripe";
import { promoAssignments, promoCodes } from "./schema";
import { needsMintedCoupon } from "./logic";
import { sweepOrphanCoupons, syncPromoToStripe } from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong",
});

const createSchema = z
  .object({
    code: z.string().min(2).max(64).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
    kind: z.enum(["percent_off", "amount_off", "fixed_price", "free_periods"]),
    percentOff: z.number().int().min(1).max(100).optional(),
    amountCents: z.number().int().min(0).optional(),
    freePeriods: z.number().int().min(1).max(24).optional(),
    duration: z.enum(["once", "repeating", "forever"]),
    durationMonths: z.number().int().min(1).max(36).optional(),
    productId: z.string().uuid().nullable(),
    maxRedemptions: z.number().int().min(1).nullable(),
    redeemBy: z.string().nullable(), // ISO date
    isPublic: z.boolean(),
    autoApply: z.boolean(),
  })
  .refine(
    (v) =>
      (v.kind === "percent_off" && v.percentOff != null) ||
      (v.kind === "amount_off" && (v.amountCents ?? 0) > 0) ||
      (v.kind === "fixed_price" && v.amountCents != null) ||
      (v.kind === "free_periods" && v.freePeriods != null),
    { message: "Value doesn't match the discount kind" },
  );

export async function createPromoAction(input: z.infer<typeof createSchema>): Promise<ActionResult> {
  try {
    const { session } = { session: await requireOps() };
    const p = createSchema.parse(input);
    const [row] = await db
      .insert(promoCodes)
      .values({
        code: p.code.toUpperCase(),
        kind: p.kind,
        percentOff: p.kind === "percent_off" ? p.percentOff : null,
        amountCents: p.kind === "amount_off" || p.kind === "fixed_price" ? p.amountCents : null,
        freePeriods: p.kind === "free_periods" ? p.freePeriods : null,
        duration: p.kind === "free_periods" ? "repeating" : p.duration,
        durationMonths:
          p.kind === "free_periods"
            ? p.freePeriods
            : p.duration === "repeating"
              ? p.durationMonths
              : null,
        productId: p.productId,
        maxRedemptions: p.maxRedemptions,
        redeemBy: p.redeemBy ? new Date(p.redeemBy) : null,
        isPublic: p.isPublic,
        autoApply: p.autoApply,
        createdByUserId: session.user.id,
      })
      .returning();
    // Clean promos mirror to Stripe immediately; order-relative ones mint at checkout.
    if (stripeConfigured() && !needsMintedCoupon(row)) {
      await syncPromoToStripe(row.id);
    }
    revalidatePath("/ops/promos");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function archivePromoAction(promoId: string): Promise<ActionResult> {
  try {
    await requireOps();
    const promo = await db.query.promoCodes.findFirst({ where: eq(promoCodes.id, promoId) });
    if (!promo) throw new Error("Promo not found");
    await db.update(promoCodes).set({ isActive: false, autoApply: false }).where(eq(promoCodes.id, promoId));
    if (promo.stripePromotionCodeId && stripeConfigured()) {
      await getStripe()
        .promotionCodes.update(promo.stripePromotionCodeId, { active: false })
        .catch(() => {});
    }
    revalidatePath("/ops/promos");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function syncPromoAction(promoId: string): Promise<ActionResult> {
  try {
    await requireOps();
    await syncPromoToStripe(promoId);
    revalidatePath("/ops/promos");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function togglePromoAssignmentAction(
  promoId: string,
  tenantId: string,
  assigned: boolean,
): Promise<ActionResult> {
  try {
    await requireOps();
    if (assigned) {
      await db
        .insert(promoAssignments)
        .values({ promoCodeId: promoId, tenantId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(promoAssignments)
        .where(and(eq(promoAssignments.promoCodeId, promoId), eq(promoAssignments.tenantId, tenantId)));
    }
    revalidatePath("/ops/promos");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function runOrphanSweepAction(): Promise<
  { ok: true; scanned: number; deleted: number } | { ok: false; error: string }
> {
  try {
    await requireOps();
    const r = await sweepOrphanCoupons();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sweep failed" };
  }
}
