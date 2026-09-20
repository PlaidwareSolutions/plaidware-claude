import { describe, expect, it } from "vitest";
import { canChangePlatformRole, platformRoleChangeConfirm, typedEmailMatches } from "./rules";

const base = {
  actorUserId: "actor",
  targetUserId: "target",
  targetEmailVerified: true,
  current: "customer" as const,
  next: "ops_admin" as const,
  opsAdminCount: 1,
};

describe("canChangePlatformRole", () => {
  it("grants ops admin to a verified customer", () => {
    expect(canChangePlatformRole(base)).toEqual({ ok: true });
  });
  it("refuses a no-op", () => {
    expect(canChangePlatformRole({ ...base, next: "customer" })).toMatchObject({ ok: false });
  });
  it("never lets an admin change their own role", () => {
    expect(canChangePlatformRole({ ...base, actorUserId: "target", current: "ops_admin", next: "customer", opsAdminCount: 3 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/own platform role/),
    });
  });
  it("lets the bootstrap script (no actor) promote anyone", () => {
    expect(canChangePlatformRole({ ...base, actorUserId: null, targetUserId: "target" })).toEqual({ ok: true });
  });
  it("requires a verified email for ops roles only", () => {
    expect(canChangePlatformRole({ ...base, targetEmailVerified: false })).toMatchObject({ reason: expect.stringMatching(/verified/) });
    expect(canChangePlatformRole({ ...base, targetEmailVerified: false, current: "ops_admin", next: "customer", opsAdminCount: 2 })).toEqual({ ok: true });
  });
  it("protects the last ops admin", () => {
    const demote = { ...base, current: "ops_admin" as const, next: "customer" as const };
    expect(canChangePlatformRole({ ...demote, opsAdminCount: 1 })).toMatchObject({ reason: expect.stringMatching(/last ops admin/) });
    expect(canChangePlatformRole({ ...demote, opsAdminCount: 2 })).toEqual({ ok: true });
  });
});

describe("platformRoleChangeConfirm", () => {
  const who = { name: "Ada", email: "ada@x.co" };
  it("asks for a typed email whenever ops admin is involved", () => {
    expect(platformRoleChangeConfirm({ before: "customer", after: "ops_admin", ...who })).toMatchObject({ typedEmail: true, destructive: false });
    expect(platformRoleChangeConfirm({ before: "ops_admin", after: "customer", ...who })).toMatchObject({ typedEmail: true, destructive: true });
  });
  it("treats support grants as ordinary confirmations", () => {
    expect(platformRoleChangeConfirm({ before: "customer", after: "ops_support", ...who })).toMatchObject({ typedEmail: false, destructive: false });
    expect(platformRoleChangeConfirm({ before: "ops_support", after: "customer", ...who }).destructive).toBe(true);
  });
  it("names the person and the outcome", () => {
    const c = platformRoleChangeConfirm({ before: "ops_admin", after: "customer", ...who });
    expect(c.title).toMatch(/Revoke ops admin from Ada/);
    expect(c.description).toMatch(/signed out/);
  });
});

describe("typedEmailMatches", () => {
  it("ignores case and whitespace", () => {
    expect(typedEmailMatches(" A@B.co ", "a@b.co")).toBe(true);
    expect(typedEmailMatches("a@b.com", "a@b.co")).toBe(false);
    expect(typedEmailMatches(undefined, "a@b.co")).toBe(false);
  });
});
