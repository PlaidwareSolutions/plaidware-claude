import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Tenant-level authorization vocabulary (PRD § 4.2).
 * Four roles: owner (unique, transferable), admin, billing, member.
 * Resources beyond Better Auth's org defaults cover the Hub's surfaces.
 */
const statement = {
  ...defaultStatements,
  subscription: ["read", "manage"],
  billing: ["read", "manage"],
  provisioning: ["read", "manage"],
  team: ["read", "manage"],
} as const;

export const ac = createAccessControl(statement);

export const orgRoles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    subscription: ["read", "manage"],
    billing: ["read", "manage"],
    provisioning: ["read", "manage"],
    team: ["read", "manage"],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    subscription: ["read", "manage"],
    billing: ["read", "manage"],
    provisioning: ["read", "manage"],
    team: ["read", "manage"],
  }),
  billing: ac.newRole({
    subscription: ["read"],
    billing: ["read", "manage"],
    provisioning: ["read"],
    team: ["read"],
  }),
  member: ac.newRole({
    subscription: ["read"],
    provisioning: ["read"],
    team: ["read"],
  }),
};
