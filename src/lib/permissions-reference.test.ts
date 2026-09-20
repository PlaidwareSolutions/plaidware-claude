import { describe, expect, it } from "vitest";
import { TENANT_CAPABILITIES } from "@/policy/tenant-status";
import {
  PERMISSIONS_REFERENCE,
  groupBySurface,
  platformRolesForLevel,
  requirementLabel,
  tenantRolesForCapability,
} from "./permissions-reference";

describe("permissions reference", () => {
  it("has no duplicate rows", () => {
    const keys = PERMISSIONS_REFERENCE.map((e) => `${e.area}|${e.surface}|${e.action}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("mentions every capability and both ops levels", () => {
    for (const cap of TENANT_CAPABILITIES) {
      expect(PERMISSIONS_REFERENCE.some((e) => e.requires.kind === "tenant" && e.requires.cap === cap)).toBe(true);
    }
    for (const level of ["support", "admin"] as const) {
      expect(PERMISSIONS_REFERENCE.some((e) => e.requires.kind === "ops" && e.requires.level === level)).toBe(true);
    }
  });
  it("labels every requirement kind", () => {
    expect(requirementLabel({ kind: "ops", level: "admin" })).toBe("ops admin");
    expect(requirementLabel({ kind: "ops", level: "support" })).toMatch(/support/);
    expect(requirementLabel({ kind: "tenant", cap: "team" })).toMatch(/team/);
    expect(requirementLabel({ kind: "work", manage: true })).toMatch(/ops admin/);
    expect(requirementLabel({ kind: "signed_in" })).toMatch(/signed-in/);
  });
  it("resolves requirements to roles", () => {
    expect(platformRolesForLevel("support")).toEqual(["ops_support", "ops_admin"]);
    expect(platformRolesForLevel("admin")).toEqual(["ops_admin"]);
    expect(tenantRolesForCapability("billing")).toEqual(["owner", "admin", "billing"]);
    expect(tenantRolesForCapability("read")).toEqual(["owner", "admin", "billing", "member"]);
  });
  it("groups rows by surface in first-seen order", () => {
    const groups = groupBySurface();
    expect(groups[0]).toMatchObject({ area: "ops", surface: "Ops portal" });
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(PERMISSIONS_REFERENCE.length);
  });
});
