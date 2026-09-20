import type { CarryOver, WorkItemStatus } from "./contracts";

/**
 * Sprint arithmetic on calendar days (YYYY-MM-DD strings in the display
 * zone — see isoDay() in src/lib/dates). Pure, no Date objects leak out.
 */

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(b) - at(a)) / 86_400_000);
}

/**
 * Where the next sprint sits: the day after the previous one ends, or today
 * if that has already passed; `lengthDays` long, inclusive.
 */
export function nextSprintWindow(o: {
  lengthDays: number;
  previousEndsOn: string | null;
  today: string;
}): { startsOn: string; endsOn: string } {
  const afterPrevious = o.previousEndsOn ? addDays(o.previousEndsOn, 1) : o.today;
  const startsOn = afterPrevious > o.today ? afterPrevious : o.today;
  return { startsOn, endsOn: addDays(startsOn, o.lengthDays - 1) };
}

/** Days until the sprint ends (0 = ends today, negative = overdue). */
export function sprintDaysLeft(s: { endsOn: string }, today: string): number {
  return daysBetween(today, s.endsOn);
}

export function sprintIsOverdue(s: { status: string; endsOn: string }, today: string): boolean {
  return s.status === "active" && s.endsOn < today;
}

export function isClosedStatus(status: string): boolean {
  return status === "done" || status === "canceled";
}

type Pointed = { estimatePoints: number | null; status: string };

/** Snapshot at sprint start: everything in the sprint counts, unestimated items count for zero points. */
export function sprintCommitment(items: Pointed[]): { committedPoints: number; committedCount: number } {
  return {
    committedPoints: items.reduce((s, i) => s + (i.estimatePoints ?? 0), 0),
    committedCount: items.length,
  };
}

/** Snapshot at completion: only done items; canceled ones are neither done nor carried. */
export function sprintCompletion(items: Pointed[]): { completedPoints: number; completedCount: number } {
  const done = items.filter((i) => i.status === "done");
  return {
    completedPoints: done.reduce((s, i) => s + (i.estimatePoints ?? 0), 0),
    completedCount: done.length,
  };
}

/**
 * What happens to an unfinished item when its sprint completes. "next" keeps
 * the item's progress and moves it to the next sprint; "backlog" unschedules
 * it — a not-yet-started item returns to the backlog, one already in flight
 * keeps its column (visible as unscheduled work).
 */
export function carryOverPatch(
  item: { status: WorkItemStatus },
  target: CarryOver,
  nextSprintId: string | null,
): { sprintId: string | null; status: WorkItemStatus } {
  if (target === "next") return { sprintId: nextSprintId, status: item.status };
  return { sprintId: null, status: item.status === "todo" ? "backlog" : item.status };
}

/** Mean completed points over the last `n` sprints that have a snapshot; sprints are oldest first. */
export function velocity(sprints: { completedPoints: number | null }[], n = 3): number | null {
  const pts = sprints.map((s) => s.completedPoints).filter((p): p is number => p != null).slice(-n);
  if (pts.length === 0) return null;
  return Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 10) / 10;
}
