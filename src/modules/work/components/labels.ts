import type { WorkItemPriority, WorkItemSource, WorkItemType } from "../contracts";

/** Display labels and tiny formatters shared by server and client components (no "use client"). */
export const TYPE_LABELS: Record<WorkItemType, string> = { feature: "Feature", enhancement: "Enhancement", bug: "Bug", task: "Task" };
export const PRIORITY_LABELS: Record<WorkItemPriority, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
export const SOURCE_LABELS: Record<WorkItemSource, string> = { internal: "Internal", client_request: "Client request", incident: "Incident" };

export const pointsLabel = (n: number | null) => (n == null ? null : `${n} pt${n === 1 ? "" : "s"}`);

/** "auth, Billing  ui" → ["auth", "billing", "ui"] */
export function parseLabels(s: string): string[] {
  return [...new Set(s.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}
