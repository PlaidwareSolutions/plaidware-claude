import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import type { TenantCapability } from "@/policy/tenant-status";
import { TENANT_ROLES, TENANT_ROLE_META, type TenantRole } from "./roles";

/**
 * Better Auth's view of the tenant roles, derived from src/lib/roles.ts.
 * These statements are what `auth.api.createInvitation` / `updateMemberRole`
 * / `removeMember` check for tenant-side callers; src/policy is the
 * authority for everything the Hub decides itself. Client-bundle-safe
 * (imported by auth-client.ts): no db or env.
 */
const statement = {
  ...defaultStatements,
  subscription: ["read", "manage"],
  billing: ["read", "manage"],
  provisioning: ["read", "manage"],
  team: ["read", "manage"],
} as const;

export const ac = createAccessControl(statement);

type HubResource = "subscription" | "billing" | "provisioning" | "team";
type HubAction = "read" | "manage";

/** Hub capability → the resource actions it stands for. */
const CAP_STATEMENTS: Record<TenantCapability, Partial<Record<HubResource, readonly HubAction[]>>> = {
  read: { subscription: ["read"], provisioning: ["read"], team: ["read"] },
  billing: { billing: ["read", "manage"] },
  write: { subscription: ["manage"], provisioning: ["manage"] },
  team: { team: ["manage"] },
};

function statementsFor(role: TenantRole): Parameters<typeof ac.newRole>[0] {
  const merged: Partial<Record<HubResource, Set<HubAction>>> = {};
  for (const cap of TENANT_ROLE_META[role].caps) {
    for (const [resource, actions] of Object.entries(CAP_STATEMENTS[cap]) as [HubResource, readonly HubAction[]][]) {
      const set = (merged[resource] ??= new Set<HubAction>());
      for (const a of actions) set.add(a);
    }
  }
  const hub = Object.fromEntries(Object.entries(merged).map(([r, s]) => [r, [...s]]));
  // Owner/admin also keep Better Auth's own organization/member/invitation
  // statements so its endpoints authorize them the way the plugin expects.
  const base = role === "owner" ? ownerAc.statements : role === "admin" ? adminAc.statements : {};
  return { ...base, ...hub } as Parameters<typeof ac.newRole>[0];
}

export const orgRoles = Object.fromEntries(
  TENANT_ROLES.map((role) => [role, ac.newRole(statementsFor(role))]),
) as Record<TenantRole, ReturnType<typeof ac.newRole>>;
