import { STATUS_LABELS } from "./transitions";
import type { WorkItemStatus } from "./contracts";

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
  comment_added: { label: "Commented", group: "discussion" },
  comment_edited: { label: "Comment edited", group: "discussion" },
  comment_deleted: { label: "Comment deleted", group: "discussion" },
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
      return `${statusLabel(payload.before)} → ${statusLabel(payload.after)}${reason}`;
    case "priority_changed":
      return `${str(payload.before) ?? "?"} → ${str(payload.after) ?? "?"}`;
    case "assignee_changed":
      return `${ref(payload.before) ?? "unassigned"} → ${ref(payload.after) ?? "unassigned"}`;
    case "sprint_changed":
      return `${ref(payload.before) ?? "no sprint"} → ${ref(payload.after) ?? "no sprint"}${reason}`;
    case "requester_changed":
      return `${ref(payload.before) ?? "none"} → ${ref(payload.after) ?? "none"}`;
    default:
      return null;
  }
}
