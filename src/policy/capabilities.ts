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
  /** The role alone allows this — decides which surfaces are shown at all. */
  roleCan(cap: TenantCapability): boolean;
  /** Role and workspace status allow it right now — decides which controls are live. */
  can(cap: TenantCapability): boolean;
  /** Why changes are blocked (a status sentence), or null when they aren't. */
  readOnlyReason: string | null;
};

export function capabilitiesFor(
  role: string,
  status: string | null | undefined,
  ops: boolean,
): TenantCapabilities {
  return {
    role,
    ops,
    isOwner: ops || role === "owner",
    roleCan: (cap) => ops || roleHasCapability(role, cap),
    can: (cap) => ops || (roleHasCapability(role, cap) && tenantStatusAllows(status, cap)),
    readOnlyReason: ops || tenantStatusAllows(status, "write") ? null : tenantStatusMessage(status),
  };
}
