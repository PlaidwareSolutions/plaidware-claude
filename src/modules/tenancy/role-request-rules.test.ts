import { describe, expect, it } from "vitest";
import {
  canCancelRoleRequest,
  canDecideRoleRequest,
  canRequestRole,
  canRequestRoleChange,
  isRoleRequestStale,
  roleRequestAttentionTone,
  roleRequestDeciders,
} from "./role-request-rules";

describe("canRequestRoleChange", () => {
  it("lets billing and member roles ask, not owner/admin/ops", () => {
    expect(canRequestRoleChange({ role: "member", tenantStatus: "active" })).toEqual({ ok: true });
    expect(canRequestRoleChange({ role: "billing", tenantStatus: "active" })).toEqual({ ok: true });
    expect(canRequestRoleChange({ role: "admin", tenantStatus: "active" })).toMatchObject({ ok: false });
    expect(canRequestRoleChange({ role: "owner", tenantStatus: "active" })).toMatchObject({ ok: false });
    expect(canRequestRoleChange({ role: "ops", tenantStatus: "active" })).toMatchObject({ ok: false });
  });
  it("allows a suspended workspace but not an inactive one", () => {
    expect(canRequestRoleChange({ role: "member", tenantStatus: "suspended" })).toEqual({ ok: true });
    expect(canRequestRoleChange({ role: "member", tenantStatus: "inactive" })).toMatchObject({ reason: expect.stringMatching(/inactive/) });
  });
});

describe("canRequestRole", () => {
  it("only assignable roles that differ from the current one", () => {
    expect(canRequestRole({ currentRole: "member", requestedRole: "billing" })).toEqual({ ok: true });
    expect(canRequestRole({ currentRole: "billing", requestedRole: "member" })).toEqual({ ok: true });
    expect(canRequestRole({ currentRole: "member", requestedRole: "owner" })).toMatchObject({ ok: false });
    expect(canRequestRole({ currentRole: "member", requestedRole: "member" })).toMatchObject({ reason: expect.stringMatching(/already/) });
  });
});

describe("canDecideRoleRequest", () => {
  const base = { deciderUserId: "u1", requesterUserId: "u2", tenantStatus: "active" };
  it("owners and admins decide on an active workspace", () => {
    expect(canDecideRoleRequest({ ...base, deciderRole: "owner" })).toEqual({ ok: true });
    expect(canDecideRoleRequest({ ...base, deciderRole: "admin" })).toEqual({ ok: true });
    expect(canDecideRoleRequest({ ...base, deciderRole: "billing" })).toMatchObject({ ok: false });
    expect(canDecideRoleRequest({ ...base, deciderRole: "member" })).toMatchObject({ ok: false });
  });
  it("is blocked for tenant deciders while suspended, but not for ops", () => {
    expect(canDecideRoleRequest({ ...base, deciderRole: "owner", tenantStatus: "suspended" })).toMatchObject({ reason: expect.stringMatching(/suspended/) });
    expect(canDecideRoleRequest({ ...base, deciderRole: "ops", tenantStatus: "suspended" })).toEqual({ ok: true });
    expect(canDecideRoleRequest({ ...base, deciderRole: "ops", tenantStatus: "inactive" })).toEqual({ ok: true });
  });
  it("never lets the requester decide", () => {
    expect(canDecideRoleRequest({ ...base, deciderRole: "owner", deciderUserId: "u2" })).toMatchObject({ reason: expect.stringMatching(/own request/) });
  });
});

describe("canCancelRoleRequest", () => {
  it("is the requester, a decider, or ops", () => {
    expect(canCancelRoleRequest({ actorUserId: "u2", actorRole: "member", requesterUserId: "u2" })).toEqual({ ok: true });
    expect(canCancelRoleRequest({ actorUserId: "u1", actorRole: "ops", requesterUserId: "u2" })).toEqual({ ok: true });
    expect(canCancelRoleRequest({ actorUserId: "u1", actorRole: "owner", requesterUserId: "u2" })).toEqual({ ok: true });
    expect(canCancelRoleRequest({ actorUserId: "u1", actorRole: "billing", requesterUserId: "u2" })).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("detects a request whose member has since changed role", () => {
    expect(isRoleRequestStale({ currentRole: "member", liveRole: "member" })).toBe(false);
    expect(isRoleRequestStale({ currentRole: "member", liveRole: "admin" })).toBe(true);
  });
  it("emails owner and admins only", () => {
    const members = [{ role: "owner" }, { role: "admin" }, { role: "billing" }, { role: "member" }];
    expect(roleRequestDeciders(members).map((m) => m.role)).toEqual(["owner", "admin"]);
  });
  it("nudges after three days", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    expect(roleRequestAttentionTone("2026-09-19T12:00:00Z", now)).toBe("info");
    expect(roleRequestAttentionTone("2026-09-15T12:00:00Z", now)).toBe("warning");
  });
});
