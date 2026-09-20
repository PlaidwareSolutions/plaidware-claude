import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { AUTH, OPS, TENANT, withQuery } from "../lib/routes";
import { auth } from "../lib/auth";
import { db } from "../db";
import { member, organization } from "../modules/auth/schema";
import { getUserTenants, type TenantSummary } from "../modules/tenancy/queries";
import { pickActiveTenant } from "../modules/tenancy/active-tenant";
import { capabilitiesFor, roleHasCapability, type TenantCapabilities } from "./capabilities";
import { tenantStatusAllows, tenantStatusMessage, type TenantCapability } from "./tenant-status";

export {
  normalizeTenantStatus,
  tenantStatusAllows,
  tenantStatusMessage,
  type TenantCapability,
  type TenantStatus,
} from "./tenant-status";
export { capabilitiesFor, roleHasCapability, type TenantCapabilities } from "./capabilities";

/**
 * The single authorization layer (PRD § 2). Every server action, RSC query,
 * and route handler resolves access through here — never inline role checks.
 * Pure decision logic lives in the sibling files (tenant-status, capabilities)
 * so client components and tests can import it; this file is server-only.
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

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export type AppSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

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
  if (!m) throw new PolicyError(403, "You don't have access to this workspace");
  if (!roleHasCapability(m.role, cap)) {
    throw new PolicyError(403, `Your role (${m.role}) can't do this. Ask a workspace owner or admin.`);
  }
  if (!tenantStatusAllows(m.status, cap)) {
    throw new PolicyError(403, tenantStatusMessage(m.status));
  }
  return { session, role: m.role };
}

export type TenantContext = {
  session: AppSession;
  ops: boolean;
  tenants: TenantSummary[];
  /** The workspace the user is acting in; null for a user with none yet. */
  active: TenantSummary | null;
  /** What the user may do in `active`; null when there is no workspace. */
  caps: TenantCapabilities | null;
};

/**
 * Everything a tenant-facing page needs in order to decide what to show:
 * the session, the user's workspaces, the one they are acting in, and what
 * their role plus the workspace status allow. Redirects signed-out callers
 * to login (back to `returnTo` afterwards) and ops accounts that hold no
 * workspace to the ops portal, so a tenant page never bounces them around.
 */
export async function getTenantContext(opts: { returnTo?: string } = {}): Promise<TenantContext> {
  const session = await getSession();
  if (!session) redirect(withQuery(AUTH.login, { redirect: opts.returnTo }));
  const ops = isOps(session);
  const tenants = await getUserTenants(session.user.id);
  if (ops && tenants.length === 0) redirect(OPS.home);
  const active = pickActiveTenant(tenants, session.session.activeOrganizationId);
  return {
    session,
    ops,
    tenants,
    active,
    caps: active ? capabilitiesFor(active.role, active.status, ops) : null,
  };
}

/**
 * getTenantContext() for pages that only make sense inside a workspace.
 * A user without one lands on the dashboard, which explains how to get one.
 */
export async function requireTenantPage(): Promise<
  TenantContext & { active: TenantSummary; caps: TenantCapabilities }
> {
  const ctx = await getTenantContext();
  if (!ctx.active || !ctx.caps) redirect(TENANT.dashboard);
  return { ...ctx, active: ctx.active, caps: ctx.caps };
}
