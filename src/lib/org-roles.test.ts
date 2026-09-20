import { describe, expect, it } from "vitest";
import { orgRoles } from "./org-roles";

describe("orgRoles derived from the role table", () => {
  it("lets owners and admins manage the team and subscriptions", () => {
    expect(orgRoles.owner.authorize({ team: ["manage"], subscription: ["manage"] }).success).toBe(true);
    expect(orgRoles.admin.authorize({ team: ["manage"], subscription: ["manage"] }).success).toBe(true);
  });
  it("keeps Better Auth's own invitation and member statements for owner/admin", () => {
    expect(orgRoles.admin.authorize({ invitation: ["create"] }).success).toBe(true);
    expect(orgRoles.admin.authorize({ member: ["update", "delete"] }).success).toBe(true);
    expect(orgRoles.owner.authorize({ organization: ["delete"] }).success).toBe(true);
    expect(orgRoles.admin.authorize({ organization: ["delete"] }).success).toBe(false);
  });
  it("limits the billing role to billing", () => {
    expect(orgRoles.billing.authorize({ billing: ["manage"] }).success).toBe(true);
    expect(orgRoles.billing.authorize({ subscription: ["read"] }).success).toBe(true);
    expect(orgRoles.billing.authorize({ subscription: ["manage"] }).success).toBe(false);
    expect(orgRoles.billing.authorize({ team: ["manage"] }).success).toBe(false);
    expect(orgRoles.billing.authorize({ invitation: ["create"] }).success).toBe(false);
  });
  it("makes members read-only", () => {
    expect(orgRoles.member.authorize({ team: ["read"] }).success).toBe(true);
    expect(orgRoles.member.authorize({ team: ["manage"] }).success).toBe(false);
    expect(orgRoles.member.authorize({ billing: ["read"] }).success).toBe(false);
  });
});
