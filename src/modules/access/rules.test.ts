import { describe, expect, it } from "vitest";
import { PLATFORM_ROLES, PLATFORM_ROLE_META } from "@/lib/roles";
import {
  STAFF_ROLES,
  accountDisableConfirm,
  canChangePlatformRole,
  canSendPasswordSetup,
  canSetAccountDisabled,
  platformRoleChangeConfirm,
  typedEmailMatches,
} from "./rules";

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

describe("ops_support transitions", () => {
  it("needs a verified email like any ops role", () => {
    expect(canChangePlatformRole({ ...base, next: "ops_support", targetEmailVerified: false })).toMatchObject({ ok: false });
    expect(canChangePlatformRole({ ...base, next: "ops_support" })).toEqual({ ok: true });
  });
  it("counts support → admin as a grant, admin → support as a downgrade", () => {
    expect(platformRoleChangeConfirm({ before: "ops_support", after: "ops_admin", name: "A", email: "a@x.co" })).toMatchObject({ typedEmail: true, destructive: false });
    expect(platformRoleChangeConfirm({ before: "ops_admin", after: "ops_support", name: "A", email: "a@x.co" })).toMatchObject({ typedEmail: true, destructive: true });
    expect(canChangePlatformRole({ ...base, current: "ops_admin", next: "ops_support", opsAdminCount: 1 })).toMatchObject({ reason: expect.stringMatching(/last ops admin/) });
  });
});

describe("developer transitions", () => {
  const who = { name: "Dev", email: "dev@x.co" };
  it("is grantable to a verified customer without a typed email", () => {
    expect(canChangePlatformRole({ ...base, next: "developer" })).toEqual({ ok: true });
    expect(canChangePlatformRole({ ...base, next: "developer", targetEmailVerified: false })).toMatchObject({ ok: false });
    expect(platformRoleChangeConfirm({ before: "customer", after: "developer", ...who })).toMatchObject({ typedEmail: false, destructive: false });
  });
  it("revokes on the way out, not on the way up to ops", () => {
    expect(platformRoleChangeConfirm({ before: "developer", after: "customer", ...who }).destructive).toBe(true);
    expect(platformRoleChangeConfirm({ before: "developer", after: "ops_support", ...who }).destructive).toBe(false);
    expect(platformRoleChangeConfirm({ before: "ops_support", after: "developer", ...who }).destructive).toBe(true);
    expect(platformRoleChangeConfirm({ before: "ops_admin", after: "developer", ...who })).toMatchObject({ destructive: true, typedEmail: true });
  });
  it("still protects the last ops admin", () => {
    expect(canChangePlatformRole({ ...base, current: "ops_admin", next: "developer", opsAdminCount: 1 })).toMatchObject({ reason: expect.stringMatching(/last ops admin/) });
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

describe("STAFF_ROLES", () => {
  it("is every platform role that grants something", () => {
    expect([...STAFF_ROLES]).toEqual(PLATFORM_ROLES.filter((r) => PLATFORM_ROLE_META[r].grants.length > 0));
  });
});

describe("canSetAccountDisabled", () => {
  const base = {
    actorUserId: "actor",
    targetUserId: "target",
    targetRole: "customer" as const,
    currentlyDisabled: false,
    disabled: true,
    activeOpsAdminCount: 2,
  };
  it("disables an active customer", () => {
    expect(canSetAccountDisabled(base)).toEqual({ ok: true });
  });
  it("never lets an admin disable themselves, but a script may", () => {
    expect(canSetAccountDisabled({ ...base, actorUserId: "target" })).toMatchObject({ reason: expect.stringMatching(/own account/) });
    expect(canSetAccountDisabled({ ...base, actorUserId: null, targetUserId: "target" })).toEqual({ ok: true });
  });
  it("refuses a no-op in either direction", () => {
    expect(canSetAccountDisabled({ ...base, currentlyDisabled: true })).toMatchObject({ reason: "Already disabled." });
    expect(canSetAccountDisabled({ ...base, disabled: false })).toMatchObject({ reason: "Already active." });
  });
  it("protects the last active ops admin, and only on disable", () => {
    const admin = { ...base, targetRole: "ops_admin" as const };
    expect(canSetAccountDisabled({ ...admin, activeOpsAdminCount: 1 })).toMatchObject({ reason: expect.stringMatching(/last active ops admin/) });
    expect(canSetAccountDisabled({ ...admin, activeOpsAdminCount: 2 })).toEqual({ ok: true });
    expect(canSetAccountDisabled({ ...admin, currentlyDisabled: true, disabled: false, activeOpsAdminCount: 0 })).toEqual({ ok: true });
  });
});

describe("accountDisableConfirm", () => {
  const who = { name: "Ada", email: "ada@x.co" };
  it("is destructive and asks staff to be retyped on disable", () => {
    expect(accountDisableConfirm({ ...who, role: "ops_support", disabled: true })).toMatchObject({ destructive: true, typedEmail: true });
    expect(accountDisableConfirm({ ...who, role: "customer", disabled: true })).toMatchObject({ destructive: true, typedEmail: false });
    expect(accountDisableConfirm({ ...who, role: "ops_admin", disabled: false })).toMatchObject({ destructive: false, typedEmail: false });
  });
});

describe("canSendPasswordSetup", () => {
  it("refuses disabled accounts", () => {
    expect(canSendPasswordSetup({ targetDisabled: true })).toMatchObject({ ok: false });
    expect(canSendPasswordSetup({ targetDisabled: false })).toEqual({ ok: true });
  });
});
