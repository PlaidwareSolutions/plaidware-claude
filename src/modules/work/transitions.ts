import type { WorkBoardMode, WorkItemStatus, WorkItemType, WorkResolution } from "./contracts";

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

/**
 * The workflow: where an item may go from each status (Jira's transitions).
 * Work moves forward through In progress; Done is reached only from In
 * progress or In review, and reopening goes back to To do or In progress.
 * Open work can always be sent back to the Backlog (deprioritised).
 * Cancel is available from any open status (issue view), and a canceled item
 * comes back through Backlog or To do. The board greys out (⊘) every column
 * not listed here while a card is dragged, and the service refuses them.
 */
export const WORKFLOW: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  backlog: ["todo", "in_progress", "canceled"],
  todo: ["backlog", "in_progress", "canceled"],
  in_progress: ["backlog", "todo", "in_review", "done", "canceled"],
  in_review: ["backlog", "in_progress", "done", "canceled"],
  done: ["todo", "in_progress"],
  canceled: ["backlog", "todo"],
};

export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return WORKFLOW[from].includes(to);
}

/** Moves that open a transition screen first (Jira asks for a resolution on Done). */
export function transitionNeedsScreen(to: WorkItemStatus): boolean {
  return to === "done";
}

/** Why a move isn't allowed, phrased for a toast. */
export function blockedReason(from: WorkItemStatus, to: WorkItemStatus): string {
  const via = WORKFLOW[from].filter((s) => WORKFLOW[s].includes(to) && s !== "canceled");
  const hint = via.length ? ` Move it to ${via.map((s) => STATUS_LABELS[s]).join(" or ")} first.` : "";
  return `${STATUS_LABELS[from]} → ${STATUS_LABELS[to]} isn't part of the workflow.${hint}`;
}

export const RESOLUTION_LABELS: Record<WorkResolution, string> = {
  done: "Done",
  fixed: "Fixed",
  wont_do: "Won't do",
  duplicate: "Duplicate",
  cannot_reproduce: "Cannot reproduce",
};

/** What the transition screen pre-selects: bugs get "Fixed", everything else "Done". */
export function defaultResolution(type: WorkItemType): WorkResolution {
  return type === "bug" ? "fixed" : "done";
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
