import { describe, expect, it } from "vitest";
import {
  addDays,
  carryOverPatch,
  daysBetween,
  isClosedStatus,
  nextSprintWindow,
  sprintCommitment,
  sprintCompletion,
  sprintDaysLeft,
  sprintIsOverdue,
  velocity,
} from "./sprint-logic";

describe("calendar arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-13", "2026-09-27")).toBe(14);
    expect(daysBetween("2026-09-27", "2026-09-13")).toBe(-14);
  });
});

describe("nextSprintWindow", () => {
  it("starts today when there is no previous sprint or it ended in the past", () => {
    expect(nextSprintWindow({ lengthDays: 14, previousEndsOn: null, today: "2026-09-13" })).toEqual({ startsOn: "2026-09-13", endsOn: "2026-09-26" });
    expect(nextSprintWindow({ lengthDays: 7, previousEndsOn: "2026-09-01", today: "2026-09-13" })).toEqual({ startsOn: "2026-09-13", endsOn: "2026-09-19" });
  });
  it("starts the day after a sprint that ends in the future", () => {
    expect(nextSprintWindow({ lengthDays: 14, previousEndsOn: "2026-09-20", today: "2026-09-13" })).toEqual({ startsOn: "2026-09-21", endsOn: "2026-10-04" });
    expect(nextSprintWindow({ lengthDays: 7, previousEndsOn: "2026-09-13", today: "2026-09-13" })).toEqual({ startsOn: "2026-09-14", endsOn: "2026-09-20" });
  });
});

describe("sprint timing", () => {
  it("counts days left and flags overdue only after the end day", () => {
    expect(sprintDaysLeft({ endsOn: "2026-09-20" }, "2026-09-13")).toBe(7);
    expect(sprintDaysLeft({ endsOn: "2026-09-13" }, "2026-09-13")).toBe(0);
    expect(sprintDaysLeft({ endsOn: "2026-09-10" }, "2026-09-13")).toBe(-3);
    expect(sprintIsOverdue({ status: "active", endsOn: "2026-09-13" }, "2026-09-13")).toBe(false);
    expect(sprintIsOverdue({ status: "active", endsOn: "2026-09-12" }, "2026-09-13")).toBe(true);
    expect(sprintIsOverdue({ status: "planned", endsOn: "2026-09-01" }, "2026-09-13")).toBe(false);
    expect(sprintIsOverdue({ status: "completed", endsOn: "2026-09-01" }, "2026-09-13")).toBe(false);
  });
});

describe("points", () => {
  const items = [
    { estimatePoints: 3, status: "done" },
    { estimatePoints: null, status: "done" },
    { estimatePoints: 5, status: "in_progress" },
    { estimatePoints: 8, status: "canceled" },
  ];
  it("commits every item, counting unestimated ones as zero points", () => {
    expect(sprintCommitment(items)).toEqual({ committedPoints: 16, committedCount: 4 });
  });
  it("completes only done items", () => {
    expect(sprintCompletion(items)).toEqual({ completedPoints: 3, completedCount: 2 });
    expect(isClosedStatus("done")).toBe(true);
    expect(isClosedStatus("canceled")).toBe(true);
    expect(isClosedStatus("in_review")).toBe(false);
  });
  it("averages the last n snapshots, ignoring sprints without one", () => {
    expect(velocity([])).toBeNull();
    expect(velocity([{ completedPoints: null }])).toBeNull();
    expect(velocity([{ completedPoints: 10 }])).toBe(10);
    expect(velocity([{ completedPoints: 1 }, { completedPoints: 10 }, { completedPoints: 20 }, { completedPoints: null }, { completedPoints: 30 }])).toBe(20);
  });
});

describe("carryOverPatch", () => {
  it("moves everything forward for 'next' and keeps progress", () => {
    for (const status of ["todo", "in_progress", "in_review"] as const) {
      expect(carryOverPatch({ status }, "next", "s2")).toEqual({ sprintId: "s2", status });
    }
  });
  it("returns untouched items to the backlog and leaves started ones unscheduled", () => {
    expect(carryOverPatch({ status: "todo" }, "backlog", null)).toEqual({ sprintId: null, status: "backlog" });
    expect(carryOverPatch({ status: "in_progress" }, "backlog", null)).toEqual({ sprintId: null, status: "in_progress" });
    expect(carryOverPatch({ status: "in_review" }, "backlog", null)).toEqual({ sprintId: null, status: "in_review" });
  });
});
