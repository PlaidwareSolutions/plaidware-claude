import { tenantRoleCaps } from "@/lib/roles";
import { tenantStatusAllows, tenantStatusMessage, type TenantCapability } from "./tenant-status";

/**
 * What a tenant role may do (PRD §4.2), and what the workspace's lifecycle
 * status still lets it do right now. Pure: safe for client components and
 * tests (src/policy/index.ts is server-only).
 */

/** PRD §4.2 role → capability matrix, from the role table in src/lib/roles.ts. */
export function roleHasCapability(role: string, cap: TenantCapability): boolean {
  return tenantRoleCaps(role).has(cap);
}

export type TenantCapabilities = {
  role: string;
  /** Platform ops: every capability, never gated by workspace status. */
  ops: boolean;
  isOwner: boolean;
  /** An ops admin is viewing as this user: nothing but reading is live, whatever the role says. */
  locked: boolean;
  /** The role alone allows this — decides which surfaces are shown at all. */
  roleCan(cap: TenantCapability): boolean;
  /** Role and workspace status allow it right now — decides which controls are live. */
  can(cap: TenantCapability): boolean;
  /** Why changes are blocked (a status sentence, or the view-as notice), or null when they aren't. */
  readOnlyReason: string | null;
};

/**
 * `lock`: a sentence saying why nothing may change right now (a view-as
 * session). It beats the role and the status: `can()` is false for every
 * capability but read, and `readOnlyReason` is that sentence.
 */
export function capabilitiesFor(
  role: string,
  status: string | null | undefined,
  ops: boolean,
  lock: string | null = null,
): TenantCapabilities {
  return {
    role,
    ops,
    isOwner: ops || role === "owner",
    locked: lock !== null,
    roleCan: (cap) => ops || roleHasCapability(role, cap),
    can: (cap) => (cap === "read" || lock === null) && (ops || (roleHasCapability(role, cap) && tenantStatusAllows(status, cap))),
    readOnlyReason: lock ?? (ops || tenantStatusAllows(status, "write") ? null : tenantStatusMessage(status)),
  };
}
