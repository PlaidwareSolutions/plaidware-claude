import { describe, expect, it } from "vitest";
import { WORK_ITEM_STATUSES } from "./contracts";
import {
  WORKFLOW,
  applyTransition,
  blockedReason,
  canTransition,
  defaultResolution,
  sprintForTransition,
  statusForSprintChange,
  transitionNeedsScreen,
} from "./transitions";

const NOW = new Date("2026-09-13T12:00:00Z");
const EARLIER = new Date("2026-09-10T12:00:00Z");

describe("workflow", () => {
  it("never allows staying put, and every status has a way out", () => {
    for (const s of WORK_ITEM_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
      expect(WORKFLOW[s].length).toBeGreaterThan(0);
    }
  });
  it("reaches Done only through In progress or In review", () => {
    expect(WORK_ITEM_STATUSES.filter((s) => canTransition(s, "done"))).toEqual(["in_progress", "in_review"]);
    expect(canTransition("todo", "in_review")).toBe(false);
    expect(canTransition("backlog", "done")).toBe(false);
  });
  it("sends any open item back to the backlog, but not a Done one", () => {
    for (const s of ["todo", "in_progress", "in_review"] as const) expect(canTransition(s, "backlog")).toBe(true);
    expect(canTransition("done", "backlog")).toBe(false);
  });
  it("reopens Done to To do or In progress, and lets anything open be canceled", () => {
    expect(WORKFLOW.done).toEqual(["todo", "in_progress"]);
    for (const s of ["backlog", "todo", "in_progress", "in_review"] as const) expect(canTransition(s, "canceled")).toBe(true);
  });
  it("explains a blocked move with the way round", () => {
    expect(blockedReason("todo", "done")).toBe("To do → Done isn't part of the workflow. Move it to In progress first.");
    expect(blockedReason("backlog", "in_review")).toBe("Backlog → In review isn't part of the workflow. Move it to In progress first.");
  });
  it("asks for a resolution on Done, defaulting bugs to Fixed", () => {
    expect(transitionNeedsScreen("done")).toBe(true);
    expect(transitionNeedsScreen("in_review")).toBe(false);
    expect(defaultResolution("bug")).toBe("fixed");
    expect(defaultResolution("feature")).toBe("done");
  });
});

describe("applyTransition", () => {
  it("covers every target", () => {
    for (const to of WORK_ITEM_STATUSES) expect(applyTransition({ startedAt: null, completedAt: null }, to, NOW)).toBeDefined();
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
