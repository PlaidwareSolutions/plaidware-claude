import type { WorkBoardMode, WorkItemStatus } from "./contracts";

export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"] as const satisfies readonly WorkItemStatus[];
export const CLOSED_STATUSES = ["done", "canceled"] as const satisfies readonly WorkItemStatus[];

export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

/** Every move is allowed on a kanban board; kept as a function so a rule can land without touching the service. */
export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return from !== to;
}

/** Timestamp side effects of entering `to`. */
export function applyTransition(
  item: { startedAt: Date | null; completedAt: Date | null },
  to: WorkItemStatus,
  now: Date,
): { startedAt: Date | null; completedAt: Date | null } {
  switch (to) {
    case "in_progress":
    case "in_review":
      return { startedAt: item.startedAt ?? now, completedAt: null };
    case "done":
      return { startedAt: item.startedAt ?? now, completedAt: now };
    case "canceled":
      return { startedAt: item.startedAt, completedAt: now };
    case "todo":
      return { startedAt: item.startedAt, completedAt: null };
    case "backlog":
      return { startedAt: null, completedAt: null };
  }
}

/**
 * Which sprint an item belongs to after a status move: leaving for the
 * backlog unschedules it; on a sprints board an unscheduled item pulled onto
 * the board joins the active sprint (or stays unscheduled if none is active).
 */
export function sprintForTransition(o: {
  mode: WorkBoardMode;
  to: WorkItemStatus;
  currentSprintId: string | null;
  activeSprintId: string | null;
}): string | null {
  if (o.to === "backlog") return null;
  if (o.mode === "sprints" && o.currentSprintId == null) return o.activeSprintId;
  return o.currentSprintId;
}

/** Status side effect of an explicit sprint (un)assignment from the backlog page. */
export function statusForSprintChange(o: { status: WorkItemStatus; nextSprintId: string | null }): WorkItemStatus {
  if (o.nextSprintId && o.status === "backlog") return "todo";
  if (!o.nextSprintId && o.status === "todo") return "backlog";
  return o.status;
}
