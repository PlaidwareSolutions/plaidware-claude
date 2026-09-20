import { describe, expect, it } from "vitest";
import { capabilitiesFor, roleHasCapability } from "./capabilities";

const CAPS = ["read", "billing", "write", "team"] as const;

describe("roleHasCapability", () => {
  it("follows the PRD §4.2 matrix", () => {
    for (const cap of CAPS) {
      expect(roleHasCapability("owner", cap)).toBe(true);
      expect(roleHasCapability("admin", cap)).toBe(true);
    }
    expect(roleHasCapability("billing", "read")).toBe(true);
    expect(roleHasCapability("billing", "billing")).toBe(true);
    expect(roleHasCapability("billing", "write")).toBe(false);
    expect(roleHasCapability("billing", "team")).toBe(false);
    expect(roleHasCapability("member", "read")).toBe(true);
    expect(roleHasCapability("member", "billing")).toBe(false);
  });
  it("grants nothing to an unknown role", () => {
    for (const cap of CAPS) expect(roleHasCapability("superuser", cap)).toBe(false);
  });
});

describe("capabilitiesFor", () => {
  it("gives ops everything regardless of role or status", () => {
    const caps = capabilitiesFor("member", "inactive", true);
    for (const cap of CAPS) {
      expect(caps.can(cap)).toBe(true);
      expect(caps.roleCan(cap)).toBe(true);
    }
    expect(caps.isOwner).toBe(true);
    expect(caps.readOnlyReason).toBeNull();
  });
  it("lets a suspended admin read and pay but not change or invite", () => {
    const caps = capabilitiesFor("admin", "suspended", false);
    expect(caps.can("read")).toBe(true);
    expect(caps.can("billing")).toBe(true);
    expect(caps.can("write")).toBe(false);
    expect(caps.can("team")).toBe(false);
    expect(caps.roleCan("write")).toBe(true);
    expect(caps.readOnlyReason).toMatch(/suspended/);
    expect(caps.isOwner).toBe(false);
  });
  it("keeps the billing surface visible to a billing member of an inactive workspace", () => {
    const caps = capabilitiesFor("billing", "inactive", false);
    expect(caps.roleCan("billing")).toBe(true);
    expect(caps.can("billing")).toBe(false);
    expect(caps.readOnlyReason).toMatch(/inactive/);
  });
  it("has no read-only reason for an active member", () => {
    const caps = capabilitiesFor("member", "active", false);
    expect(caps.readOnlyReason).toBeNull();
    expect(caps.can("read")).toBe(true);
    expect(caps.can("billing")).toBe(false);
  });
  it("marks the owner", () => {
    expect(capabilitiesFor("owner", null, false).isOwner).toBe(true);
    expect(capabilitiesFor("admin", null, false).isOwner).toBe(false);
  });
});
