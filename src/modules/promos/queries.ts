import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { organization } from "../auth/schema";
import { products } from "../catalog/schema";
import { promoAssignments, promoCodes, promoRedemptions } from "./schema";

export type PromoRow = {
  id: string;
  code: string;
  kind: string;
  valueLabel: string;
  durationLabel: string;
  productName: string | null;
  isActive: boolean;
  isPublic: boolean;
  autoApply: boolean;
  synced: boolean;
  timesRedeemed: number;
  maxRedemptions: number | null;
  redeemBy: string | null;
  savingsCents: number;
  assignedTenantIds: string[];
};

export async function listPromos(): Promise<PromoRow[]> {
  const rows = await db.query.promoCodes.findMany({ orderBy: [desc(promoCodes.createdAt)] });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [reds, assigns, prods] = await Promise.all([
    db.query.promoRedemptions.findMany({ where: inArray(promoRedemptions.promoCodeId, ids) }),
    db.query.promoAssignments.findMany({ where: inArray(promoAssignments.promoCodeId, ids) }),
    db.query.products.findMany({ columns: { id: true, name: true } }),
  ]);
  const prodName = new Map(prods.map((p) => [p.id, p.name]));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    kind: r.kind,
    valueLabel:
      r.kind === "percent_off"
        ? `${r.percentOff}% off`
        : r.kind === "amount_off"
          ? `$${((r.amountCents ?? 0) / 100).toFixed(2)} off`
          : r.kind === "fixed_price"
            ? `fixed $${((r.amountCents ?? 0) / 100).toFixed(2)}`
            : `${r.freePeriods} free periods`,
    durationLabel:
      r.duration === "forever"
        ? "forever"
        : r.duration === "repeating"
          ? `${r.durationMonths} months`
          : "once",
    productName: r.productId ? (prodName.get(r.productId) ?? null) : null,
    isActive: r.isActive,
    isPublic: r.isPublic,
    autoApply: r.autoApply,
    synced: Boolean(r.stripeCouponId),
    timesRedeemed: r.timesRedeemed,
    maxRedemptions: r.maxRedemptions,
    redeemBy: r.redeemBy?.toISOString() ?? null,
    savingsCents: reds
      .filter((x) => x.promoCodeId === r.id)
      .reduce((s, x) => s + x.savingsCents, 0),
    assignedTenantIds: assigns.filter((a) => a.promoCodeId === r.id).map((a) => a.tenantId),
  }));
}

export async function listTenantOptions(): Promise<{ id: string; name: string }[]> {
  const orgs = await db.query.organization.findMany({
    columns: { id: true, name: true },
    orderBy: [organization.name],
  });
  return orgs;
}

export async function listProductOptions(): Promise<{ id: string; name: string }[]> {
  const rows = await db.query.products.findMany({
    where: eq(products.isActive, true),
    columns: { id: true, name: true },
    orderBy: [products.sortOrder],
  });
  return rows;
}
