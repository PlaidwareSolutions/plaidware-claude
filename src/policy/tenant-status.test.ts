import { describe, expect, it } from "vitest";
import {
  TENANT_CAPABILITIES,
  TENANT_STATUSES,
  normalizeTenantStatus,
  statusCapabilityMatrix,
  tenantStatusAllows,
  tenantStatusMessage,
} from "./tenant-status";

describe("tenantStatusAllows", () => {
  it("lets active workspaces do everything their role allows", () => {
    for (const cap of ["read", "billing", "write", "team"] as const) {
      expect(tenantStatusAllows("active", cap)).toBe(true);
    }
  });
  it("keeps billing reachable while suspended, blocks changes", () => {
    expect(tenantStatusAllows("suspended", "read")).toBe(true);
    expect(tenantStatusAllows("suspended", "billing")).toBe(true);
    expect(tenantStatusAllows("suspended", "write")).toBe(false);
    expect(tenantStatusAllows("suspended", "team")).toBe(false);
  });
  it("makes inactive workspaces read-only", () => {
    expect(tenantStatusAllows("inactive", "read")).toBe(true);
    expect(tenantStatusAllows("inactive", "billing")).toBe(false);
  });
  it("treats unknown or missing status as active (legacy rows)", () => {
    expect(normalizeTenantStatus(null)).toBe("active");
    expect(normalizeTenantStatus("weird")).toBe("active");
    expect(tenantStatusAllows(undefined, "team")).toBe(true);
  });
  it("publishes the same matrix the gate enforces", () => {
    const m = statusCapabilityMatrix();
    for (const s of TENANT_STATUSES) {
      for (const c of TENANT_CAPABILITIES) expect(m[s].includes(c)).toBe(tenantStatusAllows(s, c));
    }
    expect(m.suspended).toEqual(["read", "billing"]);
  });
  it("explains the block", () => {
    expect(tenantStatusMessage("suspended")).toMatch(/billing remains available/);
    expect(tenantStatusMessage("active")).toBe("");
  });
});
