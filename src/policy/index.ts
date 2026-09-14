import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { AUTH, TENANT } from "../lib/routes";
import { auth } from "../lib/auth";
import { db } from "../db";
import { member, organization } from "../modules/auth/schema";
import { tenantStatusAllows, tenantStatusMessage, type TenantCapability } from "./tenant-status";

export {
  normalizeTenantStatus,
  tenantStatusAllows,
  tenantStatusMessage,
  type TenantCapability,
  type TenantStatus,
} from "./tenant-status";

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
 * Page/layout variant of requireOps(): redirects instead of throwing. Called
 * by the ops layout (hard loads) AND by every ops page — layouts don't re-run
 * on client-side navigation, so the page check is the one that always holds.
 */
export async function requireOpsPage() {
  const session = await getSession();
  if (!session) redirect(AUTH.login);
  if (!isOps(session)) redirect(TENANT.dashboard);
  return session;
}

/**
 * Caller must be an ops admin OR hold `cap` in the tenant, AND the workspace's
 * lifecycle status must still allow `cap` (suspended → read + billing only;
 * inactive → read only). Ops admins bypass the status gate. Returns the
 * session plus the resolved membership role ("ops" for platform admins).
 */
export async function requireMembership(tenantId: string, cap: TenantCapability) {
  const session = await requireUser();
  if (isOps(session)) return { session, role: "ops" as const };

  const [m] = await db
    .select({ role: member.role, status: organization.status })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, session.user.id)))
    .limit(1);
  if (!m || !roleHasCapability(m.role, cap)) {
    throw new PolicyError(403, "You don't have access to this workspace");
  }
  if (!tenantStatusAllows(m.status, cap)) {
    throw new PolicyError(403, tenantStatusMessage(m.status));
  }
  return { session, role: m.role };
}
