import { TENANT_ROLE_META, isAssignableTenantRole } from "@/lib/roles";

/**
 * Whether ops may put an existing account straight onto a workspace (no
 * invitation), and how the change is worded. Pure so the user page can
 * pre-validate and the service can enforce the same verdict.
 */

export type AddMembershipInput = {
  /** The account's current role on that workspace, if any. */
  existingRole: string | null;
  targetDisabled: boolean;
  role: string;
};

export type RuleVerdict = { ok: true } | { ok: false; reason: string };

export function canAddMembership(i: AddMembershipInput): RuleVerdict {
  if (i.targetDisabled) return { ok: false, reason: "This account is disabled. Re-enable it first." };
  if (i.existingRole) return { ok: false, reason: `Already a member (${i.existingRole}). Change the role from the workspace's People tab.` };
  if (!isAssignableTenantRole(i.role)) return { ok: false, reason: "The owner role is assigned by transferring ownership." };
  return { ok: true };
}

/**
 * What a membership means for this account — a developer never reaches the
 * workspace; it only unlocks that client's brief in the work area.
 */
export function membershipEffect(platformRole: string | null | undefined, role: string): string {
  const what = isAssignableTenantRole(role) ? TENANT_ROLE_META[role].description.toLowerCase() : role;
  switch (platformRole) {
    case "developer":
      return "Developers stay in the work area: this unlocks the client's brief under Work → Clients (products, people, the items they asked for) and shows the client on its items. They never reach the workspace itself.";
    case "ops_admin":
      return "Ops admins already see and manage every workspace; this only lists them on the client's People tab.";
    case "ops_support":
      return `They get the workspace like any member (${what}) on top of the ops portal.`;
    default:
      return `They get the workspace right away, without an invitation email (${what}).`;
  }
}
