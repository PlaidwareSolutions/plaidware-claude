import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { organization, user } from "../auth/schema";
import { products } from "../catalog/schema";
import { onboardingInvites } from "./schema";

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
