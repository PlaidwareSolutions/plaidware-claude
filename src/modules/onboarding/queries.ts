import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { tenantPriceOverrides } from "../billing/schema";
import { onboardingInvites } from "./schema";
import { buildProductProposal, entryComponentIds, type ProposalProduct } from "./proposal";

export type TenantSetupInvite = {
  id: string;
  status: string; // pending | accepted | expired | revoked
  clientName: string;
  clientEmail: string;
  createdByName: string | null;
  productNames: string[];
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  /** A pending link is past its expiry: still "pending" in DB but effectively dead. */
  isExpired: boolean;
  /** The same link can be re-sent (a legacy row without the stored token can only be regenerated). */
  hasStoredToken: boolean;
};

/** All setup links ever minted for a tenant, newest first (ops "know your customer"). */
export async function listTenantSetupInvites(tenantId: string): Promise<TenantSetupInvite[]> {
  const rows = await db.query.onboardingInvites.findMany({
    where: eq(onboardingInvites.tenantId, tenantId),
    orderBy: [desc(onboardingInvites.createdAt)],
  });
  if (rows.length === 0) return [];

  const userIds = [
    ...new Set(rows.flatMap((r) => [r.userId, r.createdByUserId].filter((x): x is string => !!x))),
  ];
  const productIds = [...new Set(rows.flatMap((r) => r.products.map((p) => p.productId)))];
  const [users, prods] = await Promise.all([
    userIds.length
      ? db.query.user.findMany({ where: inArray(user.id, userIds) })
      : Promise.resolve([]),
    productIds.length
      ? db.query.products.findMany({ where: inArray(products.id, productIds) })
      : Promise.resolve([]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const productById = new Map(prods.map((p) => [p.id, p.name]));
  const now = Date.now();

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    clientName: userById.get(r.userId)?.name ?? "—",
    clientEmail: userById.get(r.userId)?.email ?? "—",
    createdByName: (r.createdByUserId && userById.get(r.createdByUserId)?.name) || null,
    productNames: r.products.map((p) => productById.get(p.productId) ?? "Unknown product"),
    expiresAt: r.expiresAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    isExpired: r.status === "pending" && r.expiresAt.getTime() < now,
    hasStoredToken: r.tokenEnc != null,
  }));
}

export type OpenSetupInvite = TenantSetupInvite & { tenantId: string; tenantName: string };

/** Every pending setup link on the platform (expired ones included) — the clients-list card. */
export async function listOpenSetupInvites(): Promise<OpenSetupInvite[]> {
  const rows = await db
    .select({
      id: onboardingInvites.id,
      tenantId: onboardingInvites.tenantId,
      tenantName: organization.name,
    })
    .from(onboardingInvites)
    .innerJoin(organization, eq(onboardingInvites.tenantId, organization.id))
    .where(eq(onboardingInvites.status, "pending"))
    .orderBy(desc(onboardingInvites.createdAt))
    .limit(50);
  if (rows.length === 0) return [];
  const byTenant = new Map<string, string>();
  for (const r of rows) byTenant.set(r.tenantId, r.tenantName);
  const perTenant = await Promise.all(
    [...byTenant.keys()].map(async (tenantId) => ({
      tenantId,
      invites: (await listTenantSetupInvites(tenantId)).filter((i) => i.status === "pending"),
    })),
  );
  return perTenant.flatMap(({ tenantId, invites }) =>
    invites.map((i) => ({ ...i, tenantId, tenantName: byTenant.get(tenantId) ?? "" })),
  );
}

// ---------------------------------------------------------------------------
// Pending setup links as "subscriptions on their way" (client Billing tab)
// ---------------------------------------------------------------------------

export type PendingSetupTerms = {
  inviteId: string;
  /** pending | expired (a pending row past its expiry) */
  status: "pending" | "expired";
  clientName: string;
  clientEmail: string;
  createdAt: string;
  expiresAt: string;
  hasStoredToken: boolean;
  productId: string;
  productName: string;
  productColor: string | null;
  /** Priced exactly as the welcome page shows it, as of now. */
  proposal: ProposalProduct;
};

/** Every open (or expired-but-unresolved) setup link for a tenant, one entry per product, with its priced terms. */
export async function listPendingSetupTerms(tenantId: string): Promise<PendingSetupTerms[]> {
  const rows = await db.query.onboardingInvites.findMany({
    where: and(eq(onboardingInvites.tenantId, tenantId), eq(onboardingInvites.status, "pending")),
    orderBy: [desc(onboardingInvites.createdAt)],
  });
  if (rows.length === 0) return [];
  const componentIds = [...new Set(rows.flatMap((r) => r.products.flatMap(entryComponentIds)))];
  const productIds = [...new Set(rows.flatMap((r) => r.products.map((p) => p.productId)))];
  const [users, prods, comps, overrides] = await Promise.all([
    db.query.user.findMany({ where: inArray(user.id, rows.map((r) => r.userId)) }),
    db.query.products.findMany({ where: inArray(products.id, productIds) }),
    componentIds.length
      ? db.query.productComponents.findMany({ where: inArray(productComponents.id, componentIds) })
      : Promise.resolve([]),
    db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, tenantId) }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const productById = new Map(prods.map((p) => [p.id, p]));
  const overrideAmounts = new Map(overrides.map((o) => [o.componentId, o.amountCents]));
  const now = new Date();
  return rows.flatMap((r) =>
    r.products.map((entry) => {
      const ids = entryComponentIds(entry);
      const product = productById.get(entry.productId);
      return {
        inviteId: r.id,
        status: r.expiresAt.getTime() < now.getTime() ? ("expired" as const) : ("pending" as const),
        clientName: userById.get(r.userId)?.name ?? "—",
        clientEmail: userById.get(r.userId)?.email ?? "—",
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        hasStoredToken: r.tokenEnc != null,
        productId: entry.productId,
        productName: product?.name ?? "Unknown product",
        productColor: product?.color ?? null,
        proposal: buildProductProposal(
          entry,
          product?.name ?? "Product",
          comps.filter((c) => ids.includes(c.id)),
          overrideAmounts,
          { now },
        ),
      };
    }),
  );
}
