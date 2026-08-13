import { describe, expect, it } from "vitest";
import {
  daysPastDue,
  decideDunningAction,
  isCovered,
  type BillingPolicyLike,
  type DunningCaseLike,
} from "./dunning-logic";

const policy: BillingPolicyLike = { reminderDays: [3, 7, 14], graceDays: 14, autoSuspend: true };
const fresh: DunningCaseLike = { remindersSent: 0, suspendedAt: null, paused: false };

describe("decideDunningAction", () => {
  it("stays quiet before the first threshold", () => {
    expect(decideDunningAction(policy, fresh, 0)).toEqual({ kind: "none" });
    expect(decideDunningAction(policy, fresh, 2)).toEqual({ kind: "none" });
  });

  it("fires reminders in order and never repeats", () => {
    expect(decideDunningAction(policy, fresh, 3)).toEqual({ kind: "remind", reminderIndex: 0, isFinalWarning: false });
    expect(decideDunningAction(policy, { ...fresh, remindersSent: 1 }, 4)).toEqual({ kind: "none" });
    expect(decideDunningAction(policy, { ...fresh, remindersSent: 1 }, 8)).toEqual({ kind: "remind", reminderIndex: 1, isFinalWarning: false });
  });

  it("catches up a missed reminder without skipping order", () => {
    // Sweep was down for a week: only fire the NEXT reminder, not all at once.
    expect(decideDunningAction(policy, fresh, 10)).toEqual({ kind: "remind", reminderIndex: 0, isFinalWarning: false });
  });

  it("suspends at the grace threshold, even before all reminders sent", () => {
    expect(decideDunningAction(policy, { ...fresh, remindersSent: 2 }, 14)).toEqual({ kind: "suspend" });
    expect(decideDunningAction(policy, fresh, 30)).toEqual({ kind: "suspend" });
  });

  it("marks the last reminder as the final warning", () => {
    const shortPolicy = { ...policy, graceDays: 99 };
    expect(decideDunningAction(shortPolicy, { ...fresh, remindersSent: 2 }, 14)).toEqual({
      kind: "remind",
      reminderIndex: 2,
      isFinalWarning: true,
    });
  });

  it("respects pause, suspension, and disabled auto-suspend", () => {
    expect(decideDunningAction(policy, { ...fresh, paused: true }, 30)).toEqual({ kind: "none" });
    expect(decideDunningAction(policy, { ...fresh, suspendedAt: new Date() }, 30)).toEqual({ kind: "none" });
    expect(decideDunningAction({ ...policy, autoSuspend: false }, fresh, 30)).toEqual({
      kind: "remind",
      reminderIndex: 0,
      isFinalWarning: false,
    });
  });
});

describe("daysPastDue / isCovered", () => {
  it("computes whole days", () => {
    const due = new Date("2026-08-01T00:00:00Z");
    expect(daysPastDue(due, new Date("2026-08-04T01:00:00Z"))).toBe(3);
    expect(daysPastDue(due, new Date("2026-07-30T00:00:00Z"))).toBe(-2);
  });
  it("partial payments settle only at full coverage", () => {
    expect(isCovered(10000, 4000)).toBe(false);
    expect(isCovered(10000, 10000)).toBe(true);
    expect(isCovered(10000, 12000)).toBe(true);
  });
});
