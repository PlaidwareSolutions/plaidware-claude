import { describe, expect, it } from "vitest";
import { pickActiveTenant } from "./active-tenant";

const tenants = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("pickActiveTenant", () => {
  it("returns the session's active workspace when the user is a member of it", () => {
    expect(pickActiveTenant(tenants, "b")).toEqual({ id: "b" });
  });
  it("falls back to the first workspace when the session points at one the user left", () => {
    expect(pickActiveTenant(tenants, "gone")).toEqual({ id: "a" });
  });
  it("falls back to the first workspace when the session has none active", () => {
    expect(pickActiveTenant(tenants, null)).toEqual({ id: "a" });
    expect(pickActiveTenant(tenants, undefined)).toEqual({ id: "a" });
  });
  it("is null for a user with no workspaces", () => {
    expect(pickActiveTenant([], "a")).toBeNull();
  });
});
