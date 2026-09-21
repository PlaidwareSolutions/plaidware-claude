import { OPS_LEVEL_ROLE, TENANT_ROLES, tenantRoleCaps, type OpsLevel, type PlatformRole, type TenantRole } from "./roles";
import type { TenantCapability } from "@/policy/tenant-status";

/**
 * What requires what — a hand-maintained, descriptive registry of the
 * guards in src/policy and the module actions, for the roles & permissions
 * reference. It is NOT generated: when a guard changes (requireOps level,
 * requireMembership capability, requireWork*), update the matching entry.
 * The tests only check that the registry is self-consistent.
 */

export type Requirement =
  | { kind: "ops"; level: OpsLevel }
  | { kind: "tenant"; cap: TenantCapability }
  | { kind: "work"; manage: boolean }
  | { kind: "signed_in" };

export type PermissionArea = "ops" | "tenant" | "work" | "account";

export type PermissionEntry = {
  area: PermissionArea;
  surface: string;
  action: string;
  requires: Requirement;
  note?: string;
};

const ops = (level: OpsLevel): Requirement => ({ kind: "ops", level });
const tenant = (cap: TenantCapability): Requirement => ({ kind: "tenant", cap });
const work = (manage = false): Requirement => ({ kind: "work", manage });

export const PERMISSIONS_REFERENCE: readonly PermissionEntry[] = [
  // ---- ops portal
  { area: "ops", surface: "Ops portal", action: "Open any /ops page", requires: ops("support"), note: "Support sees every page read-only; mutation controls are hidden and refused." },
  { area: "ops", surface: "Ops portal", action: "Onboard a client (/ops/clients/new)", requires: ops("admin") },
  { area: "ops", surface: "Clients", action: "Suspend, deactivate, reactivate or delete a workspace", requires: ops("admin") },
  { area: "ops", surface: "Clients", action: "Invite, change role, remove a member; fix a phone; decide role requests", requires: ops("admin"), note: "Ops admins bypass workspace membership and status." },
  { area: "ops", surface: "Accounts (Access)", action: "Change a platform role, add staff, send a set-password link", requires: ops("admin") },
  { area: "ops", surface: "Accounts (Access)", action: "Disable or re-enable an account, revoke sessions", requires: ops("admin") },
  { area: "ops", surface: "Billing", action: "Start subscriptions (incl. backdated), manual invoices, offline payments, hosting fees, dunning, billing policy, price overrides, subscription holds", requires: ops("admin") },
  { area: "ops", surface: "Products", action: "Create or edit products, components, defaults, metric definitions", requires: ops("admin") },
  { area: "ops", surface: "Provisioning", action: "Configure and run DNS verification, manage or reveal credentials", requires: ops("admin") },
  { area: "ops", surface: "Monitoring", action: "Acknowledge an incident", requires: ops("support"), note: "First-responder triage." },
  { area: "ops", surface: "Inbox", action: "Reply to or start a client thread, close a thread", requires: ops("support") },
  { area: "ops", surface: "Inbox", action: "Mark a lead contacted or archived", requires: ops("support") },
  { area: "ops", surface: "Onboarding", action: "Create, resend, regenerate or revoke a setup link", requires: ops("admin") },
  { area: "ops", surface: "System", action: "Requeue webhook deliveries, hosting costs, promos", requires: ops("admin") },
  // ---- tenant workspace
  { area: "tenant", surface: "Team", action: "Invite, cancel an invite, change a role, remove a member, decide role requests", requires: tenant("team") },
  { area: "tenant", surface: "Team", action: "Transfer ownership", requires: tenant("team"), note: "Owner only." },
  { area: "tenant", surface: "Team", action: "Request a role change, withdraw a request", requires: tenant("read"), note: "Billing and member roles; not while the workspace is inactive." },
  { area: "tenant", surface: "Billing", action: "See invoices, open the Stripe portal, pay", requires: tenant("billing") },
  { area: "tenant", surface: "Billing", action: "Buy a product, change add-ons, cancel a subscription", requires: tenant("write") },
  { area: "tenant", surface: "Provisioning", action: "Set the live domain", requires: tenant("write") },
  { area: "tenant", surface: "Monitoring", action: "Rotate the ingest key", requires: tenant("write") },
  { area: "tenant", surface: "Messages", action: "Read threads, start a thread, reply", requires: tenant("read"), note: "Also while suspended or inactive." },
  { area: "tenant", surface: "Workspace", action: "Switch the active workspace", requires: tenant("read") },
  // ---- work area
  { area: "work", surface: "Boards", action: "Open the work area; create, edit, move, assign and comment on items; plan, start and complete sprints", requires: work() },
  { area: "work", surface: "Boards", action: "Board settings, delete an item", requires: work(true) },
  { area: "work", surface: "Boards", action: "Set an item's requesting client", requires: ops("support"), note: "Developers never see client references." },
  // ---- own account
  { area: "account", surface: "Account", action: "Edit profile, change password or email, manage own sessions", requires: { kind: "signed_in" } },
];

export function requirementLabel(r: Requirement): string {
  switch (r.kind) {
    case "ops":
      return r.level === "admin" ? "ops admin" : "ops support or above";
    case "tenant":
      return `workspace capability: ${r.cap}`;
    case "work":
      return r.manage ? "ops admin (board management)" : "developer or any ops level";
    case "signed_in":
      return "any signed-in user";
  }
}

/** Platform roles that satisfy an ops-level requirement. */
export function platformRolesForLevel(level: OpsLevel): PlatformRole[] {
  return level === "admin" ? [OPS_LEVEL_ROLE.admin] : [OPS_LEVEL_ROLE.support, OPS_LEVEL_ROLE.admin];
}

/** Tenant roles that hold a capability. */
export function tenantRolesForCapability(cap: TenantCapability): TenantRole[] {
  return TENANT_ROLES.filter((r) => tenantRoleCaps(r).has(cap));
}

export type SurfaceGroup = { area: PermissionArea; surface: string; entries: PermissionEntry[] };

export function groupBySurface(entries: readonly PermissionEntry[] = PERMISSIONS_REFERENCE): SurfaceGroup[] {
  const groups: SurfaceGroup[] = [];
  for (const e of entries) {
    const g = groups.find((x) => x.area === e.area && x.surface === e.surface);
    if (g) g.entries.push(e);
    else groups.push({ area: e.area, surface: e.surface, entries: [e] });
  }
  return groups;
}
