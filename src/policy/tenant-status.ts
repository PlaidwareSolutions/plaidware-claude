/**
 * What a workspace's lifecycle status still allows its own members to do.
 * Ops admins are never gated by this — they need in to fix things.
 *
 *   active     everything the role allows
 *   suspended  read + billing (so the client can pay their way out)
 *   inactive   read only
 */
export type TenantCapability = "read" | "billing" | "write" | "team";
export type TenantStatus = "active" | "suspended" | "inactive";

const STATUS_CAPS: Record<TenantStatus, ReadonlySet<TenantCapability>> = {
  active: new Set(["read", "billing", "write", "team"]),
  suspended: new Set(["read", "billing"]),
  inactive: new Set(["read"]),
};

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
