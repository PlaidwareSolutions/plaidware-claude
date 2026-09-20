import { describe, expect, it } from "vitest";
import { OWNER_ROLE_MESSAGE, orgMutationBlockReason } from "./org-guards";

const active = { status: "active" };

describe("orgMutationBlockReason", () => {
  it("never grants the owner role directly", () => {
    expect(orgMutationBlockReason("invite", active, { role: "owner" })).toBe(OWNER_ROLE_MESSAGE);
    expect(orgMutationBlockReason("accept", active, { role: "owner" })).toBe(OWNER_ROLE_MESSAGE);
    expect(orgMutationBlockReason("update-role", active, { role: "member", newRole: "owner" })).toBe(
      OWNER_ROLE_MESSAGE,
    );
    expect(orgMutationBlockReason("update-role", active, { role: "member", newRole: "admin,owner" })).toBe(
      OWNER_ROLE_MESSAGE,
    );
  });
  it("protects the owner membership", () => {
    expect(orgMutationBlockReason("update-role", active, { role: "owner", newRole: "admin" })).toMatch(
      /owner can't be given a different role/,
    );
    expect(orgMutationBlockReason("remove", active, { role: "owner" })).toMatch(/owner can't be removed/);
  });
  it("lets the creator membership through on add", () => {
    expect(orgMutationBlockReason("add", active, { role: "owner" })).toBeNull();
  });
  it("blocks every team change while suspended or inactive", () => {
    for (const status of ["suspended", "inactive"]) {
      for (const kind of ["invite", "add", "accept", "update-role", "remove"] as const) {
        const reason = orgMutationBlockReason(kind, { status }, { role: "member", newRole: "admin" });
        expect(reason, `${kind} on ${status}`).toBeTruthy();
      }
      expect(orgMutationBlockReason("invite", { status }, { role: "admin" })).toMatch(
        status === "suspended" ? /suspended/ : /inactive/,
      );
    }
  });
  it("allows ordinary changes on an active workspace", () => {
    expect(orgMutationBlockReason("invite", active, { role: "admin" })).toBeNull();
    expect(orgMutationBlockReason("update-role", active, { role: "member", newRole: "billing" })).toBeNull();
    expect(orgMutationBlockReason("remove", active, { role: "admin" })).toBeNull();
    expect(orgMutationBlockReason("accept", active, { role: "member" })).toBeNull();
  });
  it("treats missing or unknown status as active", () => {
    expect(orgMutationBlockReason("invite", {}, { role: "member" })).toBeNull();
    expect(orgMutationBlockReason("remove", { status: "weird" }, { role: "member" })).toBeNull();
    expect(orgMutationBlockReason("remove", { status: null }, {})).toBeNull();
  });
});
