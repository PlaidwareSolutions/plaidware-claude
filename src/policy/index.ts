import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { db } from "../db";
import { member } from "../modules/auth/schema";

/**
 * The single authorization layer (PRD § 2). Every server action, RSC query,
 * and route handler resolves access through here — never inline role checks.
 */

export class PolicyError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

export type TenantCapability = "read" | "billing" | "write" | "team";

/** PRD §4.2 role → capability matrix. */
const ROLE_CAPS: Record<string, ReadonlySet<TenantCapability>> = {
  owner: new Set(["read", "billing", "write", "team"]),
  admin: new Set(["read", "billing", "write", "team"]),
  billing: new Set(["read", "billing"]),
  member: new Set(["read"]),
};

export function roleHasCapability(role: string, cap: TenantCapability): boolean {
  return ROLE_CAPS[role]?.has(cap) ?? false;
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) throw new PolicyError(401, "Sign in required");
  return session;
}

export function isOps(session: { user: { platformRole?: string | null } }) {
  return session.user.platformRole === "ops_admin";
}

export async function requireOps() {
  const session = await requireUser();
  if (!isOps(session)) throw new PolicyError(403, "Ops access required");
  return session;
}

/**
 * Caller must be an ops admin OR hold `cap` in the tenant. Returns the session
 * plus the resolved membership role ("ops" for platform admins).
 */
export async function requireMembership(tenantId: string, cap: TenantCapability) {
  const session = await requireUser();
  if (isOps(session)) return { session, role: "ops" as const };

  const m = await db.query.member.findFirst({
    where: and(eq(member.organizationId, tenantId), eq(member.userId, session.user.id)),
  });
  if (!m || !roleHasCapability(m.role, cap)) {
    throw new PolicyError(403, "You don't have access to this workspace");
  }
  return { session, role: m.role };
}
