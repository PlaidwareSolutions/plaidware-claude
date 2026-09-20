import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { invitation, member, organization, session, user } from "../auth/schema";
import { roleRequests } from "./schema";
import { subscriptions } from "../billing/schema";
import { products } from "../catalog/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { isMarketingSlug } from "../webhooks_out/logic";

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
};

export async function getUserTenants(userId: string): Promise<TenantSummary[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
  return rows.map((r) => ({ ...r, status: r.status ?? "active" }));
}

export type MemberRow = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  platformRole: string;
  emailVerified: boolean;
  joinedAt: Date;
  /** Most recent session activity; null = never signed in. */
  lastSeenAt: Date | null;
};

export async function listMembers(tenantId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: member.role,
      platformRole: user.platformRole,
      emailVerified: user.emailVerified,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, tenantId))
    .orderBy(member.createdAt);
  if (rows.length === 0) return [];

  const seen = await db
    .select({
      userId: session.userId,
      lastSeenAt: sql<Date>`max(${session.updatedAt})`,
    })
    .from(session)
    .where(inArray(session.userId, rows.map((r) => r.userId)))
    .groupBy(session.userId);
  const lastSeen = new Map(seen.map((s) => [s.userId, s.lastSeenAt]));

  return rows.map((r) => ({
    ...r,
    platformRole: r.platformRole ?? "customer",
    lastSeenAt: lastSeen.get(r.userId) ?? null,
  }));
}

export type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  inviterName: string | null;
};

export async function listPendingInvites(tenantId: string): Promise<InviteRow[]> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviterName: user.name,
    })
    .from(invitation)
    .leftJoin(user, eq(invitation.inviterId, user.id))
    .where(and(eq(invitation.organizationId, tenantId), eq(invitation.status, "pending")))
    .orderBy(desc(invitation.expiresAt));
  return rows.map((r) => ({ ...r, role: r.role ?? "member" }));
}

export type OpsTenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  memberCount: number;
  createdAt: Date;
  stripeCustomerId: string | null;
};

export async function listAllTenants(): Promise<OpsTenantRow[]> {
  const orgs = await db.query.organization.findMany({
    orderBy: [desc(organization.createdAt)],
  });
  if (orgs.length === 0) return [];
  const members = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(inArray(member.organizationId, orgs.map((o) => o.id)));
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.organizationId, (counts.get(m.organizationId) ?? 0) + 1);
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug ?? "",
    status: o.status ?? "active",
    memberCount: counts.get(o.id) ?? 0,
    createdAt: o.createdAt,
    stripeCustomerId: o.stripeCustomerId,
  }));
}

/** tenantId → owner email (first owner by join date; falls back to any member). */
export async function listTenantOwnerEmails(): Promise<Record<string, string>> {
  const rows = await db
    .select({ organizationId: member.organizationId, email: user.email, role: member.role, joinedAt: member.createdAt })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .orderBy(member.createdAt);
  // Rows arrive oldest-first: the first owner wins; any member is the fallback.
  const out: Record<string, string> = {};
  const hasOwner = new Set<string>();
  for (const r of rows) {
    if (hasOwner.has(r.organizationId)) continue;
    if (r.role === "owner") {
      out[r.organizationId] = r.email;
      hasOwner.add(r.organizationId);
    } else if (!out[r.organizationId]) {
      out[r.organizationId] = r.email;
    }
  }
  return out;
}

export async function getTenant(tenantId: string) {
  return db.query.organization.findFirst({ where: eq(organization.id, tenantId) });
}

export async function findUserByEmail(email: string) {
  return db.query.user.findFirst({ where: eq(user.email, email.toLowerCase()) });
}

// ---------------------------------------------------------------------------
// Ops → Client page header (layout-level; every tab shares it)
// ---------------------------------------------------------------------------

export type ClientHeader = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  ownerName: string | null;
  ownerEmail: string | null;
  memberCount: number;
  stripeCustomerId: string | null;
  /** Holds a live marketing-* subscription → MHub owns part of this client. */
  hasMarketing: boolean;
};

export async function getClientHeader(tenantId: string): Promise<ClientHeader | null> {
  const org = await db.query.organization.findFirst({ where: eq(organization.id, tenantId) });
  if (!org) return null;
  const [members, marketing] = await Promise.all([
    db
      .select({ role: member.role, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, tenantId))
      .orderBy(member.createdAt),
    db
      .select({ slug: products.slug })
      .from(subscriptions)
      .innerJoin(products, eq(subscriptions.productId, products.id))
      .where(and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES))),
  ]);
  const owner = members.find((m) => m.role === "owner") ?? members[0] ?? null;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug ?? "",
    status: org.status ?? "active",
    createdAt: org.createdAt.toISOString(),
    ownerName: owner?.name ?? null,
    ownerEmail: owner?.email ?? null,
    memberCount: members.length,
    stripeCustomerId: org.stripeCustomerId,
    hasMarketing: marketing.some((m) => isMarketingSlug(m.slug)),
  };
}

// ---------------------------------------------------------------------------
// Role requests (self-service role changes)
// ---------------------------------------------------------------------------

export type RoleRequestRow = {
  id: string;
  tenantId: string;
  memberId: string;
  userId: string;
  requesterName: string;
  requesterEmail: string;
  /** Role held when the request was made … */
  currentRole: string;
  /** … and the role held now (differs when it changed by other means). */
  liveRole: string;
  requestedRole: string;
  note: string | null;
  status: string;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
};

const roleRequestSelect = {
  id: roleRequests.id,
  tenantId: roleRequests.tenantId,
  memberId: roleRequests.memberId,
  userId: roleRequests.userId,
  requesterName: user.name,
  requesterEmail: user.email,
  currentRole: roleRequests.currentRole,
  liveRole: member.role,
  requestedRole: roleRequests.requestedRole,
  note: roleRequests.note,
  status: roleRequests.status,
  createdAt: roleRequests.createdAt,
  decidedAt: roleRequests.decidedAt,
  decisionNote: roleRequests.decisionNote,
};

export async function listPendingRoleRequests(tenantId: string): Promise<RoleRequestRow[]> {
  return db
    .select(roleRequestSelect)
    .from(roleRequests)
    .innerJoin(user, eq(roleRequests.userId, user.id))
    .innerJoin(member, eq(roleRequests.memberId, member.id))
    .where(and(eq(roleRequests.tenantId, tenantId), eq(roleRequests.status, "pending")))
    .orderBy(roleRequests.createdAt);
}

export async function getOpenRoleRequestForUser(tenantId: string, userId: string): Promise<RoleRequestRow | null> {
  const [row] = await db
    .select(roleRequestSelect)
    .from(roleRequests)
    .innerJoin(user, eq(roleRequests.userId, user.id))
    .innerJoin(member, eq(roleRequests.memberId, member.id))
    .where(and(eq(roleRequests.tenantId, tenantId), eq(roleRequests.userId, userId), eq(roleRequests.status, "pending")))
    .limit(1);
  return row ?? null;
}

export async function countPendingRoleRequests(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(roleRequests)
    .where(and(eq(roleRequests.tenantId, tenantId), eq(roleRequests.status, "pending")));
  return Number(row?.n ?? 0);
}
