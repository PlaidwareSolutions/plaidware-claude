import { describe, expect, it } from "vitest";
import { WORK_ITEM_STATUSES } from "./contracts";
import { applyTransition, canTransition, sprintForTransition, statusForSprintChange } from "./transitions";

const NOW = new Date("2026-09-13T12:00:00Z");
const EARLIER = new Date("2026-09-10T12:00:00Z");

describe("applyTransition", () => {
  it("covers every target from every source", () => {
    for (const from of WORK_ITEM_STATUSES) {
      for (const to of WORK_ITEM_STATUSES) {
        expect(canTransition(from, to)).toBe(from !== to);
        const r = applyTransition({ startedAt: null, completedAt: null }, to, NOW);
        expect(r).toBeDefined();
      }
    }
  });
  it("stamps start on first work and completion on done", () => {
    expect(applyTransition({ startedAt: null, completedAt: null }, "in_progress", NOW)).toEqual({ startedAt: NOW, completedAt: null });
    expect(applyTransition({ startedAt: null, completedAt: null }, "done", NOW)).toEqual({ startedAt: NOW, completedAt: NOW });
  });
  it("preserves the original start across in progress → in review → done", () => {
    const a = applyTransition({ startedAt: null, completedAt: null }, "in_progress", EARLIER);
    const b = applyTransition(a, "in_review", NOW);
    const c = applyTransition(b, "done", NOW);
    expect(b.startedAt).toBe(EARLIER);
    expect(c).toEqual({ startedAt: EARLIER, completedAt: NOW });
  });
  it("clears completion on reopen and everything on a return to the backlog", () => {
    const done = { startedAt: EARLIER, completedAt: EARLIER };
    expect(applyTransition(done, "in_review", NOW)).toEqual({ startedAt: EARLIER, completedAt: null });
    expect(applyTransition(done, "todo", NOW)).toEqual({ startedAt: EARLIER, completedAt: null });
    expect(applyTransition(done, "backlog", NOW)).toEqual({ startedAt: null, completedAt: null });
    expect(applyTransition({ startedAt: null, completedAt: null }, "canceled", NOW)).toEqual({ startedAt: null, completedAt: NOW });
  });
});

describe("sprintForTransition", () => {
  it("never assigns on a kanban board", () => {
    expect(sprintForTransition({ mode: "kanban", to: "todo", currentSprintId: null, activeSprintId: "s1" })).toBeNull();
    expect(sprintForTransition({ mode: "kanban", to: "done", currentSprintId: "s0", activeSprintId: "s1" })).toBe("s0");
  });
  it("joins the active sprint only when the item has none", () => {
    expect(sprintForTransition({ mode: "sprints", to: "todo", currentSprintId: null, activeSprintId: "s1" })).toBe("s1");
    expect(sprintForTransition({ mode: "sprints", to: "todo", currentSprintId: "s0", activeSprintId: "s1" })).toBe("s0");
    expect(sprintForTransition({ mode: "sprints", to: "in_progress", currentSprintId: null, activeSprintId: null })).toBeNull();
  });
  it("unschedules anything sent to the backlog", () => {
    expect(sprintForTransition({ mode: "sprints", to: "backlog", currentSprintId: "s0", activeSprintId: "s1" })).toBeNull();
  });
});

describe("statusForSprintChange", () => {
  it("promotes backlog items when planned and demotes untouched ones when unplanned", () => {
    expect(statusForSprintChange({ status: "backlog", nextSprintId: "s1" })).toBe("todo");
    expect(statusForSprintChange({ status: "todo", nextSprintId: null })).toBe("backlog");
    expect(statusForSprintChange({ status: "in_progress", nextSprintId: null })).toBe("in_progress");
    expect(statusForSprintChange({ status: "todo", nextSprintId: "s2" })).toBe("todo");
    expect(statusForSprintChange({ status: "done", nextSprintId: "s2" })).toBe("done");
  });
});
