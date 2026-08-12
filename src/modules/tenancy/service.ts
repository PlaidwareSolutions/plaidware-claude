import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { member, organization } from "../auth/schema";

export type TenantStatus = "active" | "suspended" | "inactive";

/** Used by ops creation now and checkout auto-creation in M3. */
export async function createTenantWithOwner(opts: {
  name: string;
  slug: string;
  ownerUserId: string;
}) {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organization)
      .values({
        id: crypto.randomUUID(),
        name: opts.name,
        slug: opts.slug,
        status: "active",
        createdAt: new Date(),
      })
      .returning();
    await tx.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: org.id,
      userId: opts.ownerUserId,
      role: "owner",
      createdAt: new Date(),
    });
    return org;
  });
}

/** Derive a unique slug from a seed (email local-part or name) — PRD §4.2. */
export async function uniqueSlug(seed: string): Promise<string> {
  const base =
    seed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tenant";
  let candidate = base;
  for (let i = 2; ; i++) {
    const hit = await db.query.organization.findFirst({
      where: eq(organization.slug, candidate),
      columns: { id: true },
    });
    if (!hit) return candidate;
    candidate = `${base}-${i}`;
  }
}

export async function setTenantStatus(tenantId: string, status: TenantStatus) {
  const [row] = await db
    .update(organization)
    .set({ status })
    .where(eq(organization.id, tenantId))
    .returning();
  if (!row) throw new Error("Tenant not found");
  return row;
}

/**
 * Exactly one owner per tenant (PRD §4.2): transfer demotes the current owner
 * to admin and promotes the target, atomically.
 */
export async function transferOwnership(tenantId: string, toUserId: string) {
  return db.transaction(async (tx) => {
    const owner = await tx.query.member.findFirst({
      where: and(eq(member.organizationId, tenantId), eq(member.role, "owner")),
    });
    if (!owner) throw new Error("Tenant has no owner");
    if (owner.userId === toUserId) return; // already the owner
    const target = await tx.query.member.findFirst({
      where: and(eq(member.organizationId, tenantId), eq(member.userId, toUserId)),
    });
    if (!target) throw new Error("New owner must already be a member");
    await tx.update(member).set({ role: "admin" }).where(eq(member.id, owner.id));
    await tx.update(member).set({ role: "owner" }).where(eq(member.id, target.id));
  });
}

/** Owner memberships are protected: not removable, role not editable (PRD §4.2). */
export function assertNotOwner(role: string, action: string): void {
  if (role === "owner") {
    throw new Error(`The owner can't be ${action}. Transfer ownership first.`);
  }
}

export async function deleteTenantPreview(tenantId: string) {
  const members = await db.query.member.findMany({
    where: eq(member.organizationId, tenantId),
    columns: { id: true },
  });
  // Subscriptions/invoices join this preview in M3.
  return { members: members.length };
}

export async function deleteTenant(tenantId: string, confirmSlug: string) {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, tenantId),
  });
  if (!org) throw new Error("Tenant not found");
  if (org.slug !== confirmSlug) {
    throw new Error("Confirmation doesn't match the tenant slug");
  }
  await db.delete(organization).where(eq(organization.id, tenantId));
  return org;
}
