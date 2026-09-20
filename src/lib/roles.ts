import type { TenantCapability } from "@/policy/tenant-status";

/**
 * The one place that knows which roles exist and what they mean.
 *
 * Tenant roles (PRD §4.2) live on a workspace membership; platform roles
 * live on the user record. Better Auth's access-control statements
 * (src/lib/org-roles.ts), the policy capability matrix
 * (src/policy/capabilities.ts), zod contracts, role pickers and status
 * pills all derive from these tables — nothing else lists a role by hand.
 *
 * Pure and client-bundle-safe: no db, env or server imports.
 */

// ---------------------------------------------------------------------------
// Tenant roles
// ---------------------------------------------------------------------------

export const TENANT_ROLES = ["owner", "admin", "billing", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export type TenantRoleMeta = {
  label: string;
  /** One line for role pickers and confirmations. */
  description: string;
  /** Owner moves only by transfer; it is never invited or assigned. */
  assignable: boolean;
  caps: readonly TenantCapability[];
};

export const TENANT_ROLE_META: Record<TenantRole, TenantRoleMeta> = {
  owner: {
    label: "owner",
    description: "Everything, including transferring ownership",
    assignable: false,
    caps: ["read", "billing", "write", "team"],
  },
  admin: {
    label: "admin",
    description: "Everything except ownership",
    assignable: true,
    caps: ["read", "billing", "write", "team"],
  },
  billing: {
    label: "billing",
    description: "Invoices and payment methods",
    assignable: true,
    caps: ["read", "billing"],
  },
  member: {
    label: "member",
    description: "Read only",
    assignable: true,
    caps: ["read"],
  },
};

/** Roles an owner/admin (or ops) may invite someone as or switch them to. */
export const ASSIGNABLE_TENANT_ROLES = ["admin", "billing", "member"] as const satisfies readonly TenantRole[];
export type AssignableTenantRole = (typeof ASSIGNABLE_TENANT_ROLES)[number];

export function isTenantRole(v: unknown): v is TenantRole {
  return typeof v === "string" && (TENANT_ROLES as readonly string[]).includes(v);
}

export function isAssignableTenantRole(v: unknown): v is AssignableTenantRole {
  return typeof v === "string" && (ASSIGNABLE_TENANT_ROLES as readonly string[]).includes(v);
}

const CAP_SETS: Record<TenantRole, ReadonlySet<TenantCapability>> = {
  owner: new Set(TENANT_ROLE_META.owner.caps),
  admin: new Set(TENANT_ROLE_META.admin.caps),
  billing: new Set(TENANT_ROLE_META.billing.caps),
  member: new Set(TENANT_ROLE_META.member.caps),
};
const NO_CAPS: ReadonlySet<TenantCapability> = new Set();

/** The capabilities a role holds; an unknown role holds none. */
export function tenantRoleCaps(role: string): ReadonlySet<TenantCapability> {
  return isTenantRole(role) ? CAP_SETS[role] : NO_CAPS;
}

// ---------------------------------------------------------------------------
// Platform roles
// ---------------------------------------------------------------------------

export const PLATFORM_ROLES = ["customer", "developer", "ops_support", "ops_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Ops access levels, lowest to highest. `requireOps(min)` compares these. */
export type OpsLevel = "support" | "admin";

/** What a platform role unlocks. Losing any of these on a role change is a downgrade. */
export type PlatformGrant = "ops_read" | "ops_admin" | "work";

export const PLATFORM_ROLE_META: Record<
  PlatformRole,
  { label: string; description: string; level: 0 | 1 | 2; grants: readonly PlatformGrant[] }
> = {
  customer: {
    label: "customer",
    description: "A client account; access comes from workspace memberships",
    level: 0,
    grants: [],
  },
  developer: {
    label: "developer",
    description: "The work area only — no clients, billing or monitoring",
    // Level 0 on purpose: hasOpsLevel() must never treat a developer as ops.
    level: 0,
    grants: ["work"],
  },
  ops_support: {
    label: "ops support",
    description: "Reads the ops portal, handles client messages and incident triage",
    level: 1,
    grants: ["ops_read", "work"],
  },
  ops_admin: {
    label: "ops admin",
    description: "Full operational control of the platform",
    level: 2,
    grants: ["ops_read", "ops_admin", "work"],
  },
};

export const OPS_LEVEL_ROLE: Record<OpsLevel, PlatformRole> = {
  support: "ops_support",
  admin: "ops_admin",
};

export function isPlatformRole(v: unknown): v is PlatformRole {
  return typeof v === "string" && (PLATFORM_ROLES as readonly string[]).includes(v);
}

/** Missing or unknown values (legacy rows) are customers. */
export function normalizePlatformRole(v: string | null | undefined): PlatformRole {
  return isPlatformRole(v) ? v : "customer";
}

export function opsLevelOf(role: string | null | undefined): OpsLevel | null {
  switch (normalizePlatformRole(role)) {
    case "ops_admin":
      return "admin";
    case "ops_support":
      return "support";
    default:
      return null;
  }
}

/** True when `role` is at least `min` (an admin satisfies "support"). */
export function hasOpsLevel(role: string | null | undefined, min: OpsLevel): boolean {
  return PLATFORM_ROLE_META[normalizePlatformRole(role)].level >= PLATFORM_ROLE_META[OPS_LEVEL_ROLE[min]].level;
}

/** May open the work area (/work): developers and every ops level. */
export function roleHasWorkAccess(role: string | null | undefined): boolean {
  return PLATFORM_ROLE_META[normalizePlatformRole(role)].grants.includes("work");
}

/** A change that removes access (used to decide whether to sign the user out). */
export function isDowngrade(before: PlatformRole, after: PlatformRole): boolean {
  const kept = PLATFORM_ROLE_META[after].grants;
  return PLATFORM_ROLE_META[before].grants.some((g) => !kept.includes(g));
}
