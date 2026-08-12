import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { invitation, member, organization, user } from "../auth/schema";

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
  role: string;
  joinedAt: Date;
};

export async function listMembers(tenantId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, tenantId))
    .orderBy(member.createdAt);
  return rows;
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
  }));
}

export async function getTenant(tenantId: string) {
  return db.query.organization.findFirst({ where: eq(organization.id, tenantId) });
}

export async function findUserByEmail(email: string) {
  return db.query.user.findFirst({ where: eq(user.email, email.toLowerCase()) });
}

export type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  platformRole: string;
  emailVerified: boolean;
  createdAt: Date;
  tenants: string[];
};

export async function listPlatformUsers(): Promise<PlatformUserRow[]> {
  const users = await db.query.user.findMany({ orderBy: [desc(user.createdAt)] });
  const memberships = users.length
    ? await db
        .select({ userId: member.userId, orgName: organization.name })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(inArray(member.userId, users.map((u) => u.id)))
    : [];
  const byUser = new Map<string, string[]>();
  for (const m of memberships) {
    byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m.orgName]);
  }
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    platformRole: u.platformRole ?? "customer",
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    tenants: byUser.get(u.id) ?? [],
  }));
}
