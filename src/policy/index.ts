import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { AUTH, OPS, TENANT, WORK, withQuery } from "../lib/routes";
import { hasOpsLevel, normalizePlatformRole, opsLevelOf, roleHasWorkAccess, type OpsLevel } from "../lib/roles";
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

type SessionLike = { user: { platformRole?: string | null } };

export function opsLevel(session: SessionLike): OpsLevel | null {
  return opsLevelOf(session.user.platformRole);
}

/** Any ops account (support or admin): may open the ops portal. */
export function isOps(session: SessionLike) {
  return hasOpsLevel(session.user.platformRole, "support");
}

/** Full operational control — the only level that bypasses tenant membership and status. */
export function isOpsAdmin(session: SessionLike) {
  return hasOpsLevel(session.user.platformRole, "admin");
}

/** Work-area-only staff: never ops, and kept out of every tenant page. */
export function isDeveloper(session: SessionLike) {
  return normalizePlatformRole(session.user.platformRole) === "developer";
}

/** May open /work: developers and every ops level. */
export function hasWorkAccess(session: SessionLike) {
  return roleHasWorkAccess(session.user.platformRole);
}

export type WorkViewer = { userId: string; isOps: boolean };

/**
 * Who is reading the work area. Work queries build client-facing DTOs from
 * this and strip the requesting-client reference unless `isOps` — so a
 * developer's payload never carries a tenant id or name.
 */
export function workViewer(session: SessionLike & { user: { id: string } }): WorkViewer {
  return { userId: session.user.id, isOps: isOps(session) };
}

/** Work-area server actions: create/edit/move/comment/plan sprints. */
export async function requireWork() {
  const session = await requireUser();
  if (!hasWorkAccess(session)) throw new PolicyError(403, "Work area access required");
  return session;
}

/** Page/layout variant of requireWork(): redirects instead of throwing (same layout-vs-page note as requireOpsPage). */
export async function requireWorkPage() {
  const session = await getSession();
  if (!session) redirect(AUTH.login);
  if (!hasWorkAccess(session)) redirect(TENANT.dashboard);
  return session;
}

/** Board settings, item deletion, developer accounts: ops admins only. */
export async function requireWorkManage() {
  const session = await requireUser();
  if (!isOpsAdmin(session)) throw new PolicyError(403, "Ops admin access required to manage this board");
  return session;
}

/** Ops-only server actions; admin unless the action is explicitly open to support. */
export async function requireOps(min: OpsLevel = "admin") {
  const session = await requireUser();
  if (!hasOpsLevel(session.user.platformRole, min)) {
    throw new PolicyError(403, min === "admin" ? "Ops admin access required" : "Ops access required");
  }
  return session;
}

/**
 * Page/layout variant of requireOps(): redirects instead of throwing. Called
 * by the ops layout (hard loads) AND by every ops page — layouts don't re-run
 * on client-side navigation, so the page check is the one that always holds.
 * Ops pages pass "support" (read mode); pure-mutation pages keep the default.
 */
export async function requireOpsPage(min: OpsLevel = "admin") {
  const session = await getSession();
  if (!session) redirect(AUTH.login);
  if (!hasOpsLevel(session.user.platformRole, min)) redirect(isOps(session) ? OPS.home : TENANT.dashboard);
  return session;
}

/**
 * Caller must be an ops admin OR hold `cap` in the tenant, AND the workspace's
 * lifecycle status must still allow `cap` (suspended → read + billing only;
 * inactive → read only). Ops admins bypass the status gate; ops support has
 * no bypass (they work through the ops pages). Returns the session plus the
 * resolved membership role ("ops" for platform admins).
 */
export async function requireMembership(tenantId: string, cap: TenantCapability) {
  const session = await requireUser();
  if (isOpsAdmin(session)) return { session, role: "ops" as const };

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
  /** Ops admin: every capability, never gated by workspace status. */
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
 * to login (back to `returnTo` afterwards), developers to the work area
 * (their whole Hub), and ops accounts that hold no workspace to the ops
 * portal, so a tenant page never bounces them around.
 */
export async function getTenantContext(opts: { returnTo?: string } = {}): Promise<TenantContext> {
  const session = await getSession();
  if (!session) redirect(withQuery(AUTH.login, { redirect: opts.returnTo }));
  if (isDeveloper(session)) redirect(WORK.home);
  const ops = isOpsAdmin(session);
  const tenants = await getUserTenants(session.user.id);
  if (isOps(session) && tenants.length === 0) redirect(OPS.home);
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
