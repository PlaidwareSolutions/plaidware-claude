import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { account, member, organization, session, user } from "../auth/schema";
import { PLATFORM_ROLES, isPlatformRole, normalizePlatformRole, type PlatformRole } from "@/lib/roles";

export type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  platformRole: string;
  emailVerified: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
  tenants: { id: string; name: string }[];
};

export type PlatformUserFilter = { q?: string; role?: string; status?: string };

/**
 * Accounts on the platform with their memberships, for the Access tab.
 * Server-side filtered and capped (no pagination anywhere in the app): when
 * `hasMore` is true the table asks for a narrower search.
 */
export async function listPlatformUsers(
  filter: PlatformUserFilter = {},
  limit = 200,
): Promise<{ users: PlatformUserRow[]; hasMore: boolean }> {
  const conds = [];
  const q = filter.q?.trim();
  if (q) conds.push(or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)));
  if (filter.role && isPlatformRole(filter.role)) {
    const role: PlatformRole = filter.role;
    conds.push(role === "customer" ? or(eq(user.platformRole, role), isNull(user.platformRole)) : eq(user.platformRole, role));
  }
  if (filter.status === "disabled") conds.push(isNotNull(user.disabledAt));
  else if (filter.status === "active") conds.push(isNull(user.disabledAt));
  const rows = await db.query.user.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(user.createdAt)],
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const users = rows.slice(0, limit);
  if (users.length === 0) return { users: [], hasMore: false };
  const ids = users.map((u) => u.id);
  const [memberships, seen] = await Promise.all([
    db
      .select({ userId: member.userId, orgId: organization.id, orgName: organization.name })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(inArray(member.userId, ids)),
    db
      .select({ userId: session.userId, lastSeenAt: sql<Date>`max(${session.updatedAt})` })
      .from(session)
      .where(inArray(session.userId, ids))
      .groupBy(session.userId),
  ]);
  const byUser = new Map<string, { id: string; name: string }[]>();
  for (const m of memberships) {
    byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), { id: m.orgId, name: m.orgName }]);
  }
  const lastSeen = new Map(seen.map((s) => [s.userId, s.lastSeenAt]));
  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      platformRole: u.platformRole ?? "customer",
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      lastSeenAt: lastSeen.get(u.id) ?? null,
      disabledAt: u.disabledAt ?? null,
      tenants: byUser.get(u.id) ?? [],
    })),
    hasMore,
  };
}

export async function countOpsAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(user)
    .where(eq(user.platformRole, "ops_admin"));
  return Number(row?.n ?? 0);
}

/** Ops admins who can actually sign in — the guard for disabling one. */
export async function countActiveOpsAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(user)
    .where(and(eq(user.platformRole, "ops_admin"), isNull(user.disabledAt)));
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// One account (the ops user page)
// ---------------------------------------------------------------------------

export type PlatformUserDetail = {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  platformRole: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  /** A credential account with a password exists (else the set-password link is a first-time setup). */
  hasPassword: boolean;
  activeSessionCount: number;
  membershipCount: number;
};

export async function getPlatformUser(id: string): Promise<PlatformUserDetail | null> {
  const u = await db.query.user.findFirst({ where: eq(user.id, id) });
  if (!u) return null;
  const now = new Date();
  const [cred, [seen], [active], [mem]] = await Promise.all([
    db.query.account.findFirst({
      where: and(eq(account.userId, id), eq(account.providerId, "credential")),
      columns: { password: true },
    }),
    db.select({ last: sql<Date | null>`max(${session.updatedAt})` }).from(session).where(eq(session.userId, id)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(session)
      .where(and(eq(session.userId, id), gt(session.expiresAt, now))),
    db.select({ n: sql<number>`count(*)` }).from(member).where(eq(member.userId, id)),
  ]);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    platformRole: u.platformRole ?? "customer",
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    lastSeenAt: seen?.last ?? null,
    disabledAt: u.disabledAt ?? null,
    disabledReason: u.disabledReason ?? null,
    hasPassword: !!cred?.password,
    activeSessionCount: Number(active?.n ?? 0),
    membershipCount: Number(mem?.n ?? 0),
  };
}

export type UserSessionRow = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  expired: boolean;
  activeTenant: { id: string; name: string } | null;
};

/** A person's sessions, newest activity first; never the token. */
export async function listUserSessions(userId: string, limit = 50): Promise<UserSessionRow[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      tenantId: organization.id,
      tenantName: organization.name,
    })
    .from(session)
    .leftJoin(organization, eq(session.activeOrganizationId, organization.id))
    .where(eq(session.userId, userId))
    .orderBy(desc(session.updatedAt))
    .limit(limit);
  return rows.map(({ tenantId, tenantName, ...r }) => ({
    ...r,
    ipAddress: r.ipAddress || null,
    userAgent: r.userAgent || null,
    expired: r.expiresAt <= now,
    activeTenant: tenantId && tenantName ? { id: tenantId, name: tenantName } : null,
  }));
}

/** How many accounts hold each platform role (null rows count as customers). */
export async function countUsersByPlatformRole(): Promise<Record<PlatformRole, number>> {
  const rows = await db
    .select({ role: user.platformRole, n: sql<number>`count(*)` })
    .from(user)
    .groupBy(user.platformRole);
  const out = Object.fromEntries(PLATFORM_ROLES.map((r) => [r, 0])) as Record<PlatformRole, number>;
  for (const r of rows) out[normalizePlatformRole(r.role)] += Number(r.n);
  return out;
}
