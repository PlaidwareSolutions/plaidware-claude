import { describe, expect, it } from "vitest";
import { canAddMembership, membershipEffect } from "./membership-rules";

describe("canAddMembership", () => {
  it("adds an active account that isn't on the workspace, in an assignable role", () => {
    expect(canAddMembership({ existingRole: null, targetDisabled: false, role: "member" })).toEqual({ ok: true });
    expect(canAddMembership({ existingRole: null, targetDisabled: false, role: "admin" })).toEqual({ ok: true });
  });
  it("refuses disabled accounts, existing members and the owner role", () => {
    expect(canAddMembership({ existingRole: null, targetDisabled: true, role: "member" })).toMatchObject({ reason: expect.stringMatching(/disabled/) });
    expect(canAddMembership({ existingRole: "billing", targetDisabled: false, role: "member" })).toMatchObject({ reason: expect.stringMatching(/Already a member \(billing\)/) });
    expect(canAddMembership({ existingRole: null, targetDisabled: false, role: "owner" })).toMatchObject({ reason: expect.stringMatching(/transferring ownership/) });
    expect(canAddMembership({ existingRole: null, targetDisabled: false, role: "nonsense" })).toMatchObject({ ok: false });
  });
});

describe("membershipEffect", () => {
  it("explains that a developer never reaches the workspace", () => {
    expect(membershipEffect("developer", "member")).toMatch(/Work → Clients/);
    expect(membershipEffect("developer", "member")).toMatch(/never reach the workspace/);
  });
  it("describes the role for customers and support, and the no-op for ops admins", () => {
    expect(membershipEffect("customer", "billing")).toMatch(/without an invitation email \(invoices and payment methods\)/);
    expect(membershipEffect(null, "member")).toMatch(/read only/);
    expect(membershipEffect("ops_support", "admin")).toMatch(/on top of the ops portal/);
    expect(membershipEffect("ops_admin", "member")).toMatch(/already see and manage/);
  });
});
