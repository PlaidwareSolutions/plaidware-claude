import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { member, organization, session, user } from "../auth/schema";
import { isPlatformRole, type PlatformRole } from "@/lib/roles";

export type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  platformRole: string;
  emailVerified: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  tenants: { id: string; name: string }[];
};

export type PlatformUserFilter = { q?: string; role?: string };

/** Every account on the platform with its memberships, for the Access tab. */
export async function listPlatformUsers(filter: PlatformUserFilter = {}): Promise<PlatformUserRow[]> {
  const conds = [];
  const q = filter.q?.trim();
  if (q) conds.push(or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)));
  if (filter.role && isPlatformRole(filter.role)) {
    const role: PlatformRole = filter.role;
    conds.push(role === "customer" ? or(eq(user.platformRole, role), isNull(user.platformRole)) : eq(user.platformRole, role));
  }
  const users = await db.query.user.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(user.createdAt)],
  });
  if (users.length === 0) return [];
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
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    platformRole: u.platformRole ?? "customer",
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    lastSeenAt: lastSeen.get(u.id) ?? null,
    tenants: byUser.get(u.id) ?? [],
  }));
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
