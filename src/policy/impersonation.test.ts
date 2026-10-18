import { describe, expect, it } from "vitest";
import {
  IMPERSONATABLE_PLATFORM_ROLES,
  impersonationOf,
  isImpersonatableRole,
  viewAsMessage,
} from "./impersonation";

describe("IMPERSONATABLE_PLATFORM_ROLES", () => {
  it("is every role below ops admin", () => {
    expect(IMPERSONATABLE_PLATFORM_ROLES).toEqual(["customer", "developer", "ops_support"]);
  });
  it("never includes ops admin or unknown values", () => {
    expect(isImpersonatableRole("ops_admin")).toBe(false);
    expect(isImpersonatableRole("superuser")).toBe(false);
    expect(isImpersonatableRole(undefined)).toBe(false);
    expect(isImpersonatableRole(null)).toBe(false);
    expect(isImpersonatableRole("customer")).toBe(true);
    expect(isImpersonatableRole("developer")).toBe(true);
    expect(isImpersonatableRole("ops_support")).toBe(true);
  });
});

describe("impersonationOf", () => {
  const expiresAt = new Date("2026-09-26T12:00:00Z");
  it("is null for a missing or ordinary session", () => {
    expect(impersonationOf(null)).toBeNull();
    expect(impersonationOf(undefined)).toBeNull();
    expect(impersonationOf({ session: { expiresAt } })).toBeNull();
    expect(impersonationOf({ session: { impersonatedBy: null, expiresAt } })).toBeNull();
    expect(impersonationOf({ session: { impersonatedBy: "", expiresAt } })).toBeNull();
  });
  it("names the ops admin and the end of the view", () => {
    expect(impersonationOf({ session: { impersonatedBy: "admin-1", expiresAt } })).toEqual({ actorUserId: "admin-1", expiresAt });
    expect(impersonationOf({ session: { impersonatedBy: "admin-1", expiresAt: expiresAt.toISOString() } })?.expiresAt).toEqual(expiresAt);
  });
});

describe("viewAsMessage", () => {
  it("names the person being viewed and how to get out", () => {
    const m = viewAsMessage("Jane Doe");
    expect(m).toContain("Jane Doe");
    expect(m).toMatch(/read-only/i);
    expect(m).toMatch(/stop viewing/i);
  });
});
