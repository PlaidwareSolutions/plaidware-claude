import { RESOLUTION_LABELS, STATUS_LABELS } from "./transitions";
import type { WorkItemStatus, WorkResolution } from "./contracts";

/**
 * Every work-item event `kind` the service writes, with the label and group
 * the item's activity feed renders. Unknown kinds still render (humanised).
 * Mirrors src/modules/audit/kinds.ts.
 */
export type WorkEventGroup = "lifecycle" | "flow" | "people" | "planning" | "discussion";

const KINDS: Record<string, { label: string; group: WorkEventGroup }> = {
  item_created: { label: "Created", group: "lifecycle" },
  item_updated: { label: "Edited", group: "lifecycle" },
  status_changed: { label: "Status changed", group: "flow" },
  priority_changed: { label: "Priority changed", group: "flow" },
  assignee_changed: { label: "Assignee changed", group: "people" },
  sprint_changed: { label: "Sprint changed", group: "planning" },
  requester_changed: { label: "Requesting client changed", group: "lifecycle" },
  flag_added: { label: "Flag added", group: "flow" },
  flag_removed: { label: "Flag removed", group: "flow" },
  parent_changed: { label: "Epic changed", group: "planning" },
  comment_added: { label: "Commented", group: "discussion" },
  mentioned: { label: "Mentioned people", group: "discussion" },
  comment_edited: { label: "Comment edited", group: "discussion" },
  comment_deleted: { label: "Comment deleted", group: "discussion" },
  link_added: { label: "Linked", group: "planning" },
  link_removed: { label: "Link removed", group: "planning" },
  item_moved: { label: "Moved", group: "lifecycle" },
  attachment_added: { label: "Attached a file", group: "discussion" },
  attachment_removed: { label: "Removed a file", group: "discussion" },
};

/** Events that name a client; queries drop them for developers. item_created never carries the requester. */
export const OPS_ONLY_EVENT_KINDS: ReadonlySet<string> = new Set(["requester_changed"]);

export function workEventLabel(kind: string): string {
  return KINDS[kind]?.label ?? kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function workEventGroup(kind: string): WorkEventGroup {
  return KINDS[kind]?.group ?? "lifecycle";
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const ref = (v: unknown): string | null =>
  v && typeof v === "object" && "name" in v && typeof (v as { name: unknown }).name === "string"
    ? (v as { name: string }).name
    : null;
const statusLabel = (v: unknown) => (str(v) && str(v)! in STATUS_LABELS ? STATUS_LABELS[str(v) as WorkItemStatus] : (str(v) ?? "?"));

const REASONS: Record<string, string> = {
  carry_over: "carried over",
  sprint_assigned: "added to sprint",
  sprint_removed: "removed from sprint",
  sprint_completed: "sprint completed",
  sprint_deleted: "sprint deleted",
};

/** One-line detail from the payload, per kind. */
export function describeWorkEvent(kind: string, payload: Record<string, unknown>): string | null {
  const reason = str(payload.reason) ? ` · ${REASONS[str(payload.reason)!] ?? str(payload.reason)}` : "";
  switch (kind) {
    case "item_created":
      return [str(payload.type), str(payload.priority), statusLabel(payload.status)].filter(Boolean).join(" · ") || null;
    case "item_updated": {
      const fields = payload.fields && typeof payload.fields === "object" ? Object.keys(payload.fields as object) : [];
      return fields.length ? fields.join(", ") : null;
    }
    case "status_changed":
      return `${statusLabel(payload.before)} → ${statusLabel(payload.after)}${str(payload.resolution) ? ` (${RESOLUTION_LABELS[str(payload.resolution) as WorkResolution] ?? str(payload.resolution)})` : ""}${reason}`;
    case "parent_changed":
      return `${ref(payload.before) ?? "no epic"} → ${ref(payload.after) ?? "no epic"}`;
    case "flag_added":
      return str(payload.reason);
    case "mentioned": {
      const n = Array.isArray(payload.userIds) ? payload.userIds.length : 0;
      return `${n} ${n === 1 ? "person" : "people"} in ${str(payload.commentId) ? "a comment" : "the description"}`;
    }
    case "priority_changed":
      return `${str(payload.before) ?? "?"} → ${str(payload.after) ?? "?"}`;
    case "assignee_changed":
      return `${ref(payload.before) ?? "unassigned"} → ${ref(payload.after) ?? "unassigned"}`;
    case "sprint_changed":
      return `${ref(payload.before) ?? "no sprint"} → ${ref(payload.after) ?? "no sprint"}${reason}`;
    case "requester_changed":
      return `${ref(payload.before) ?? "none"} → ${ref(payload.after) ?? "none"}`;
    case "link_added":
    case "link_removed":
      return [str(payload.phrase), ref(payload.other)].filter(Boolean).join(" ") || null;
    case "item_moved": {
      const cleared = [payload.clearedSprint ? "sprint" : null, payload.clearedEpic ? "epic" : null].filter(Boolean);
      return `${str(payload.from) ?? "?"} → ${str(payload.to) ?? "?"}${cleared.length ? ` · ${cleared.join(" and ")} cleared` : ""}`;
    }
    case "attachment_added":
    case "attachment_removed":
      return str(payload.fileName);
    default:
      return null;
  }
}
