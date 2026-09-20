/**
 * What a workspace's lifecycle status still allows its own members to do.
 * Ops admins are never gated by this — they need in to fix things.
 *
 *   active     everything the role allows
 *   suspended  read + billing (so the client can pay their way out)
 *   inactive   read only
 */
export const TENANT_CAPABILITIES = ["read", "billing", "write", "team"] as const;
export type TenantCapability = (typeof TENANT_CAPABILITIES)[number];
export const TENANT_STATUSES = ["active", "suspended", "inactive"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const STATUS_CAPS: Record<TenantStatus, ReadonlySet<TenantCapability>> = {
  active: new Set(["read", "billing", "write", "team"]),
  suspended: new Set(["read", "billing"]),
  inactive: new Set(["read"]),
};

/** Status → capabilities still allowed, for the roles & permissions reference. */
export function statusCapabilityMatrix(): Record<TenantStatus, readonly TenantCapability[]> {
  const out = {} as Record<TenantStatus, readonly TenantCapability[]>;
  for (const s of TENANT_STATUSES) out[s] = TENANT_CAPABILITIES.filter((c) => STATUS_CAPS[s].has(c));
  return out;
}

export function normalizeTenantStatus(status: string | null | undefined): TenantStatus {
  return status === "suspended" || status === "inactive" ? status : "active";
}

export function tenantStatusAllows(status: string | null | undefined, cap: TenantCapability): boolean {
  return STATUS_CAPS[normalizeTenantStatus(status)].has(cap);
}

/** The sentence a blocked member sees. */
export function tenantStatusMessage(status: string | null | undefined): string {
  switch (normalizeTenantStatus(status)) {
    case "suspended":
      return "This workspace is suspended — billing remains available so an open invoice can be paid.";
    case "inactive":
      return "This workspace is inactive. Contact Plaidware to reactivate it.";
    default:
      return "";
  }
}
