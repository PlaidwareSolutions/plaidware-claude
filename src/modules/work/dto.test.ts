import { describe, expect, it } from "vitest";
import { canSeeTenant, toCardDto, toCommentDto, toSprintDto, visibleEvents, type CardRow } from "./dto";

const row: CardRow = {
  id: "i1",
  number: 42,
  keyPrefix: "BLD",
  type: "bug",
  title: "Login fails",
  status: "in_progress",
  priority: "high",
  rank: "n",
  estimatePoints: 3,
  assigneeId: "u1",
  assigneeName: "Ada",
  sprintId: "s1",
  source: "client_request",
  labels: ["auth"],
  dueOn: "2026-09-30",
  commentCount: 2,
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-02T10:00:00Z"),
  requesterTenantId: "org_acme",
  requesterTenantName: "ACME Corp",
};
const dev = { userId: "u9", isOps: false, tenantIds: [] };
/** A developer an ops admin added to the ACME workspace. */
const acmeDev = { userId: "u9", isOps: false, tenantIds: ["org_acme"] };
const ops = { userId: "u1", isOps: true, tenantIds: [] };

describe("toCardDto", () => {
  it("never lets a client reference reach a developer", () => {
    const dto = toCardDto(row, dev);
    expect("requester" in dto).toBe(false);
    const json = JSON.stringify(dto);
    expect(json).not.toContain("org_acme");
    expect(json).not.toContain("ACME");
    expect(json).not.toContain("requester");
    expect(dto.key).toBe("BLD-42");
    expect(dto.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(dto.assignee).toEqual({ id: "u1", name: "Ada" });
  });
  it("gives ops the requester, or null when there is none", () => {
    expect(toCardDto(row, ops).requester).toEqual({ tenantId: "org_acme", tenantName: "ACME Corp" });
    expect(toCardDto({ ...row, requesterTenantId: null, requesterTenantName: null }, ops).requester).toBeNull();
  });
  it("shows a developer only the clients whose workspace they're on", () => {
    expect(toCardDto(row, acmeDev).requester).toEqual({ tenantId: "org_acme", tenantName: "ACME Corp" });
    const other = toCardDto({ ...row, requesterTenantId: "org_other", requesterTenantName: "Other Co" }, acmeDev);
    expect("requester" in other).toBe(false);
    expect(JSON.stringify(other)).not.toContain("Other");
    // No client at all: the key stays absent for developers (ops get an explicit null).
    expect("requester" in toCardDto({ ...row, requesterTenantId: null, requesterTenantName: null }, acmeDev)).toBe(false);
  });
});

describe("canSeeTenant", () => {
  it("is every client for ops and the memberships for a developer", () => {
    expect(canSeeTenant(ops, "org_anything")).toBe(true);
    expect(canSeeTenant(ops, null)).toBe(true);
    expect(canSeeTenant(acmeDev, "org_acme")).toBe(true);
    expect(canSeeTenant(acmeDev, "org_other")).toBe(false);
    expect(canSeeTenant(acmeDev, null)).toBe(false);
    expect(canSeeTenant(dev, "org_acme")).toBe(false);
  });
});

describe("visibleEvents", () => {
  const events = [{ kind: "item_created" }, { kind: "requester_changed" }, { kind: "status_changed" }];
  it("hides ops-only kinds from developers", () => {
    expect(visibleEvents(events, dev).map((e) => e.kind)).toEqual(["item_created", "status_changed"]);
    expect(visibleEvents(events, ops)).toHaveLength(3);
  });
  it("lets a member developer see a requester change only when every client named is theirs", () => {
    const acme = { id: "org_acme", name: "ACME Corp" };
    const other = { id: "org_other", name: "Other Co" };
    const rows = [
      { kind: "requester_changed", payload: { before: null, after: acme } },
      { kind: "requester_changed", payload: { before: acme, after: other } },
      { kind: "requester_changed", payload: { before: other, after: null } },
      { kind: "requester_changed", payload: { before: null, after: null } },
      { kind: "status_changed", payload: { before: "todo", after: "done" } },
    ];
    const seen = visibleEvents(rows, acmeDev);
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen)).not.toContain("org_other");
    expect(visibleEvents(rows, dev).map((e) => e.kind)).toEqual(["status_changed"]);
    expect(visibleEvents(rows, ops)).toHaveLength(5);
  });
});

describe("toCommentDto", () => {
  const c = { id: "c1", body: "hi", authorId: "u9", authorName: "Dev", createdAt: new Date("2026-09-01T10:00:00Z"), editedAt: null };
  it("lets the author or ops edit", () => {
    expect(toCommentDto(c, dev).canEdit).toBe(true);
    expect(toCommentDto(c, { userId: "u2", isOps: false, tenantIds: [] }).canEdit).toBe(false);
    expect(toCommentDto(c, ops).canEdit).toBe(true);
    expect(toCommentDto({ ...c, authorId: null }, { userId: "u2", isOps: false, tenantIds: [] }).canEdit).toBe(false);
  });
});

describe("toSprintDto", () => {
  it("adds days left and overdue from today", () => {
    const s = {
      id: "s1", boardId: "b1", number: 1, name: "Sprint 1", goal: null,
      startsOn: "2026-09-01", endsOn: "2026-09-14", status: "active" as const,
      committedPoints: 10, committedCount: 4, completedPoints: null, completedCount: null,
      startedAt: new Date("2026-09-01T09:00:00Z"), completedAt: null,
    };
    expect(toSprintDto(s, "2026-09-10")).toMatchObject({ daysLeft: 4, isOverdue: false, startedAt: "2026-09-01T09:00:00.000Z", completedAt: null });
    expect(toSprintDto(s, "2026-09-16")).toMatchObject({ daysLeft: -2, isOverdue: true });
  });
});
