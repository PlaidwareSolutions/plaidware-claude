import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_TENANT_ROLES,
  TENANT_ROLES,
  TENANT_ROLE_META,
  hasOpsLevel,
  isDowngrade,
  normalizePlatformRole,
  opsLevelOf,
  roleHasWorkAccess,
  tenantRoleCaps,
} from "./roles";

const CAPS = ["read", "billing", "write", "team"] as const;

describe("tenant roles", () => {
  it("hold the PRD §4.2 capabilities", () => {
    for (const cap of CAPS) {
      expect(tenantRoleCaps("owner").has(cap)).toBe(true);
      expect(tenantRoleCaps("admin").has(cap)).toBe(true);
    }
    expect([...tenantRoleCaps("billing")].sort()).toEqual(["billing", "read"]);
    expect([...tenantRoleCaps("member")]).toEqual(["read"]);
  });
  it("grant nothing to an unknown role", () => {
    expect(tenantRoleCaps("superuser").size).toBe(0);
  });
  it("never let the owner role be assigned", () => {
    expect(ASSIGNABLE_TENANT_ROLES).not.toContain("owner");
    for (const r of ASSIGNABLE_TENANT_ROLES) expect(TENANT_ROLE_META[r].assignable).toBe(true);
    expect(TENANT_ROLE_META.owner.assignable).toBe(false);
    expect(TENANT_ROLES.filter((r) => TENANT_ROLE_META[r].assignable)).toEqual([...ASSIGNABLE_TENANT_ROLES]);
  });
});

describe("platform roles", () => {
  it("treat missing or unknown values as customers", () => {
    expect(normalizePlatformRole(null)).toBe("customer");
    expect(normalizePlatformRole(undefined)).toBe("customer");
    expect(normalizePlatformRole("weird")).toBe("customer");
    expect(normalizePlatformRole("ops_admin")).toBe("ops_admin");
  });
  it("map roles to ops levels", () => {
    expect(opsLevelOf("ops_admin")).toBe("admin");
    expect(opsLevelOf("ops_support")).toBe("support");
    expect(opsLevelOf("customer")).toBeNull();
    expect(opsLevelOf(null)).toBeNull();
  });
  it("compare levels so an admin satisfies support", () => {
    expect(hasOpsLevel("ops_admin", "support")).toBe(true);
    expect(hasOpsLevel("ops_admin", "admin")).toBe(true);
    expect(hasOpsLevel("ops_support", "support")).toBe(true);
    expect(hasOpsLevel("ops_support", "admin")).toBe(false);
    expect(hasOpsLevel("customer", "support")).toBe(false);
    expect(hasOpsLevel(null, "support")).toBe(false);
  });
  it("know which changes remove access", () => {
    expect(isDowngrade("ops_admin", "customer")).toBe(true);
    expect(isDowngrade("ops_admin", "ops_support")).toBe(true);
    expect(isDowngrade("ops_support", "customer")).toBe(true);
    expect(isDowngrade("customer", "ops_support")).toBe(false);
    expect(isDowngrade("ops_admin", "ops_admin")).toBe(false);
    // developer: gaining ops keeps the work grant; leaving for customer loses it
    expect(isDowngrade("customer", "developer")).toBe(false);
    expect(isDowngrade("developer", "customer")).toBe(true);
    expect(isDowngrade("developer", "ops_support")).toBe(false);
    expect(isDowngrade("ops_support", "developer")).toBe(true);
    expect(isDowngrade("ops_admin", "developer")).toBe(true);
  });
  it("keep developers outside the ops levels but inside the work area", () => {
    expect(normalizePlatformRole("developer")).toBe("developer");
    expect(opsLevelOf("developer")).toBeNull();
    expect(hasOpsLevel("developer", "support")).toBe(false);
    expect(roleHasWorkAccess("developer")).toBe(true);
    expect(roleHasWorkAccess("ops_support")).toBe(true);
    expect(roleHasWorkAccess("ops_admin")).toBe(true);
    expect(roleHasWorkAccess("customer")).toBe(false);
    expect(roleHasWorkAccess(null)).toBe(false);
  });
});
