import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_META,
  TENANT_ROLES,
  TENANT_ROLE_META,
  tenantRoleCaps,
  type PlatformGrant,
} from "./roles";
import {
  TENANT_CAPABILITIES,
  TENANT_STATUSES,
  statusCapabilityMatrix,
  tenantStatusMessage,
  type TenantCapability,
} from "@/policy/tenant-status";

/**
 * The role tables rendered as matrices for the roles & permissions
 * reference and the tenant "what each role can do" explainer. Everything
 * here is derived from src/lib/roles.ts and src/policy/tenant-status.ts,
 * so a capability added there shows up without touching a page. Pure and
 * client-safe.
 */

export type MatrixItem = { key: string; label: string; description?: string };
export type MatrixData = {
  rows: MatrixItem[];
  columns: MatrixItem[];
  /** row key → column keys that are ticked */
  cells: Record<string, readonly string[]>;
};

export const CAPABILITY_META: Record<TenantCapability, { label: string; description: string }> = {
  read: { label: "read", description: "See the workspace: products, monitoring, team, messages" },
  billing: { label: "billing", description: "Invoices, payment methods, the Stripe portal" },
  write: { label: "write", description: "Buy products, change add-ons, cancel, domains, ingest keys" },
  team: { label: "team", description: "Invite, change roles, remove members, decide role requests" },
};

export const GRANT_META: Record<PlatformGrant, { label: string; description: string }> = {
  ops_read: { label: "ops portal", description: "Every /ops page, client messages, incident and lead triage" },
  ops_admin: { label: "ops admin", description: "Every mutation: billing, catalog, provisioning, onboarding, accounts" },
  work: { label: "work area", description: "/work boards, backlogs, sprints and items" },
};

const capabilityColumns = (): MatrixItem[] =>
  TENANT_CAPABILITIES.map((c) => ({ key: c, label: CAPABILITY_META[c].label, description: CAPABILITY_META[c].description }));

/** Tenant roles × capabilities. */
export function tenantRoleMatrix(): MatrixData {
  return {
    rows: TENANT_ROLES.map((r) => ({
      key: r,
      label: TENANT_ROLE_META[r].label,
      description: TENANT_ROLE_META[r].description,
    })),
    columns: capabilityColumns(),
    cells: Object.fromEntries(TENANT_ROLES.map((r) => [r, [...tenantRoleCaps(r)]])),
  };
}

/** Workspace status × capabilities still allowed (ops admins are never gated). */
export function statusCapabilityMatrixData(): MatrixData {
  const m = statusCapabilityMatrix();
  return {
    rows: TENANT_STATUSES.map((s) => ({
      key: s,
      label: s,
      description: s === "active" ? "everything the role allows" : tenantStatusMessage(s),
    })),
    columns: capabilityColumns(),
    cells: Object.fromEntries(TENANT_STATUSES.map((s) => [s, m[s]])),
  };
}

const GRANTS: readonly PlatformGrant[] = ["work", "ops_read", "ops_admin"];

/** Platform roles × grants. */
export function platformRoleMatrix(): MatrixData {
  return {
    rows: PLATFORM_ROLES.map((r) => ({
      key: r,
      label: PLATFORM_ROLE_META[r].label,
      description: PLATFORM_ROLE_META[r].description,
    })),
    columns: GRANTS.map((g) => ({ key: g, label: GRANT_META[g].label, description: GRANT_META[g].description })),
    cells: Object.fromEntries(PLATFORM_ROLES.map((r) => [r, PLATFORM_ROLE_META[r].grants])),
  };
}
