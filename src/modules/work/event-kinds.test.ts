import { describe, expect, it } from "vitest";
import { OPS_ONLY_EVENT_KINDS, describeWorkEvent, workEventGroup, workEventLabel } from "./event-kinds";

describe("work event kinds", () => {
  it("labels known kinds and humanises unknown ones", () => {
    expect(workEventLabel("status_changed")).toBe("Status changed");
    expect(workEventLabel("something_new")).toBe("Something new");
    expect(workEventGroup("comment_added")).toBe("discussion");
    expect(workEventGroup("nope")).toBe("lifecycle");
  });
  it("keeps the requester event ops-only", () => {
    expect(OPS_ONLY_EVENT_KINDS.has("requester_changed")).toBe(true);
    expect(OPS_ONLY_EVENT_KINDS.has("item_created")).toBe(false);
  });
  it("describes payloads", () => {
    expect(describeWorkEvent("status_changed", { before: "todo", after: "in_progress" })).toBe("To do → In progress");
    expect(describeWorkEvent("status_changed", { before: "todo", after: "backlog", reason: "carry_over" })).toBe("To do → Backlog · carried over");
    expect(describeWorkEvent("assignee_changed", { before: null, after: { id: "u1", name: "Ada" } })).toBe("unassigned → Ada");
    expect(describeWorkEvent("sprint_changed", { before: { id: "s1", name: "Sprint 1" }, after: null, reason: "sprint_completed" })).toBe("Sprint 1 → no sprint · sprint completed");
    expect(describeWorkEvent("item_updated", { fields: { title: {}, description: {} } })).toBe("title, description");
    expect(describeWorkEvent("item_created", { type: "bug", priority: "high", status: "backlog" })).toBe("bug · high · Backlog");
    expect(describeWorkEvent("comment_added", {})).toBeNull();
  });
});
