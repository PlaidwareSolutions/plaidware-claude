import { describe, expect, it } from "vitest";
import { PLATFORM_ROLES, PLATFORM_ROLE_META, TENANT_ROLES, tenantRoleCaps } from "./roles";
import { TENANT_CAPABILITIES, TENANT_STATUSES, tenantStatusAllows } from "@/policy/tenant-status";
import { platformRoleMatrix, statusCapabilityMatrixData, tenantRoleMatrix } from "./role-matrices";

describe("role matrices", () => {
  it("tenant roles × capabilities agrees with tenantRoleCaps", () => {
    const m = tenantRoleMatrix();
    expect(m.rows.map((r) => r.key)).toEqual([...TENANT_ROLES]);
    expect(m.columns.map((c) => c.key)).toEqual([...TENANT_CAPABILITIES]);
    for (const r of TENANT_ROLES) {
      for (const c of TENANT_CAPABILITIES) expect(m.cells[r].includes(c)).toBe(tenantRoleCaps(r).has(c));
    }
  });
  it("status × capabilities agrees with tenantStatusAllows", () => {
    const m = statusCapabilityMatrixData();
    for (const s of TENANT_STATUSES) {
      for (const c of TENANT_CAPABILITIES) expect(m.cells[s].includes(c)).toBe(tenantStatusAllows(s, c));
    }
    expect(m.rows.find((r) => r.key === "suspended")?.description).toMatch(/billing remains available/);
  });
  it("platform roles × grants agrees with PLATFORM_ROLE_META", () => {
    const m = platformRoleMatrix();
    expect(m.rows.map((r) => r.key)).toEqual([...PLATFORM_ROLES]);
    for (const r of PLATFORM_ROLES) {
      for (const g of m.columns) expect(m.cells[r].includes(g.key)).toBe(PLATFORM_ROLE_META[r].grants.includes(g.key as never));
    }
    expect(m.cells.developer).toEqual(["work"]);
  });
});
