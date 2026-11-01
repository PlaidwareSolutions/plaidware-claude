import { escapeHtml } from "./rich-text";
import { RESOLUTION_LABELS, STATUS_LABELS } from "./transitions";
import type { WorkItemStatus, WorkResolution } from "./contracts";

/**
 * Work email notifications (Jira-style), decided from the item's event trail.
 * Who hears about an event, what each line says, and how one person's events
 * on one item batch into a single email. Pure: the worker loads the rows,
 * these functions decide, sendEmail delivers.
 */

/** Events every watcher hears about. */
export const WATCHER_KINDS = new Set(["assignee_changed", "mentioned", "comment_added", "status_changed", "flag_added", "flag_removed"]);
/** Field edits: only the assignee hears about these (the client link stays history-only). */
export const ASSIGNEE_KINDS = new Set(["item_updated", "priority_changed", "parent_changed", "sprint_changed"]);
export const NOTIFY_KINDS = new Set([...WATCHER_KINDS, ...ASSIGNEE_KINDS]);

export type NotifyEvent = {
  id: string;
  itemId: string;
  kind: string;
  actorUserId: string | null;
  actorName: string | null;
  payload: Record<string, unknown>;
};

/** Why a person gets an event: it's about them, they own the item, or they watch it. */
export type NotifyReason = "assigned" | "mentioned" | "assignee" | "watching";

const refId = (v: unknown): string | null =>
  v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string" ? (v as { id: string }).id : null;
const refName = (v: unknown): string | null =>
  v && typeof v === "object" && "name" in v && typeof (v as { name: unknown }).name === "string" ? (v as { name: string }).name : null;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Who gets this event, and why. Watchers hear about WATCHER_KINDS; the
 * assignee hears about field edits (ASSIGNEE_KINDS); a new assignee and the
 * people mentioned hear about their own event even if they don't watch. The
 * actor never gets their own event.
 */
export function recipientsFor(e: NotifyEvent, watchers: readonly string[], assigneeId: string | null = null): Map<string, NotifyReason> {
  const out = new Map<string, NotifyReason>();
  if (!NOTIFY_KINDS.has(e.kind)) return out;
  if (ASSIGNEE_KINDS.has(e.kind)) {
    if (assigneeId) out.set(assigneeId, "assignee");
  } else if (e.kind === "mentioned") {
    for (const id of Array.isArray(e.payload.userIds) ? e.payload.userIds : []) if (typeof id === "string") out.set(id, "mentioned");
  } else {
    for (const w of watchers) out.set(w, "watching");
    if (e.kind === "comment_added" && typeof e.payload.replyToUserId === "string") out.set(e.payload.replyToUserId, "mentioned");
    if (e.kind === "assignee_changed") {
      const after = refId(e.payload.after);
      if (after) out.set(after, "assigned");
    }
  }
  if (e.actorUserId) out.delete(e.actorUserId);
  return out;
}

export type DigestLine = { html: string; text: string; personal: boolean };

/**
 * One line of an email for `recipientId`. `comments` maps comment id → plain
 * text (already trimmed for email). Returns null for a line this person
 * shouldn't see twice (a comment they were also mentioned in).
 */
export function describeEvent(
  e: NotifyEvent,
  recipientId: string,
  ctx: { comments: Map<string, string>; mentionedInComments: Set<string> },
): DigestLine | null {
  const who = escapeHtml(e.actorName ?? "Someone");
  const whoText = e.actorName ?? "Someone";
  const quote = (t: string | undefined) =>
    t ? `<blockquote style="margin:8px 0 0;padding:8px 12px;border-left:3px solid #3a4468;color:#c3c9de;white-space:pre-wrap">${escapeHtml(t)}</blockquote>` : "";
  switch (e.kind) {
    case "assignee_changed": {
      const after = refId(e.payload.after);
      const name = refName(e.payload.after);
      if (after === recipientId) return { html: `<b>${who}</b> assigned this issue to <b>you</b>.`, text: `${whoText} assigned this issue to you`, personal: true };
      if (refId(e.payload.before) === recipientId && !after) return { html: `<b>${who}</b> unassigned you from this issue.`, text: `${whoText} unassigned you`, personal: true };
      return after
        ? { html: `<b>${who}</b> assigned this issue to ${escapeHtml(name ?? "someone")}.`, text: `${whoText} assigned it to ${name ?? "someone"}`, personal: false }
        : { html: `<b>${who}</b> unassigned this issue.`, text: `${whoText} unassigned it`, personal: false };
    }
    case "mentioned": {
      const commentId = str(e.payload.commentId);
      const where = commentId ? "a comment" : "the description";
      return {
        html: `<b>${who}</b> mentioned you in ${where}.${quote(commentId ? ctx.comments.get(commentId) : str(e.payload.excerpt) ?? undefined)}`,
        text: `${whoText} mentioned you in ${where}`,
        personal: true,
      };
    }
    case "comment_added": {
      const commentId = str(e.payload.commentId);
      if (commentId && ctx.mentionedInComments.has(commentId)) return null;
      if (e.payload.replyToUserId === recipientId) {
        return { html: `<b>${who}</b> replied to your comment:${quote(commentId ? ctx.comments.get(commentId) : undefined)}`, text: `${whoText} replied to your comment`, personal: true };
      }
      return { html: `<b>${who}</b> commented:${quote(commentId ? ctx.comments.get(commentId) : undefined)}`, text: `${whoText} commented`, personal: false };
    }
    case "status_changed": {
      const before = STATUS_LABELS[str(e.payload.before) as WorkItemStatus] ?? str(e.payload.before) ?? "?";
      const after = STATUS_LABELS[str(e.payload.after) as WorkItemStatus] ?? str(e.payload.after) ?? "?";
      const res = str(e.payload.resolution);
      const resolution = res ? ` (${RESOLUTION_LABELS[res as WorkResolution] ?? res})` : "";
      return {
        html: `<b>${who}</b> changed the status: ${escapeHtml(before)} → <b>${escapeHtml(after)}</b>${escapeHtml(resolution)}.`,
        text: `${whoText} moved it to ${after}${resolution}`,
        personal: false,
      };
    }
    case "flag_added": {
      const reason = str(e.payload.reason);
      return { html: `<b>${who}</b> flagged this issue${reason ? `: ${escapeHtml(reason)}` : "."}`, text: `${whoText} flagged it`, personal: false };
    }
    case "flag_removed":
      return { html: `<b>${who}</b> removed the flag.`, text: `${whoText} removed the flag`, personal: false };
    case "item_updated": {
      const changes = describeFieldChanges(e.payload.fields);
      if (!changes.length) return null;
      return {
        html: `<b>${who}</b> updated ${changes.map((c) => c.html).join(", ")}.`,
        text: `${whoText} updated ${changes.map((c) => c.text).join(", ")}`,
        personal: false,
      };
    }
    case "priority_changed": {
      const before = PRIORITY_NAMES[str(e.payload.before) ?? ""] ?? str(e.payload.before) ?? "?";
      const after = PRIORITY_NAMES[str(e.payload.after) ?? ""] ?? str(e.payload.after) ?? "?";
      return { html: `<b>${who}</b> changed the priority: ${escapeHtml(before)} → <b>${escapeHtml(after)}</b>.`, text: `${whoText} set priority to ${after}`, personal: false };
    }
    case "parent_changed":
    case "sprint_changed": {
      const what = e.kind === "parent_changed" ? "epic" : "sprint";
      const after = refName(e.payload.after);
      return after
        ? { html: `<b>${who}</b> set the ${what} to <b>${escapeHtml(after)}</b>.`, text: `${whoText} set the ${what} to ${after}`, personal: false }
        : { html: `<b>${who}</b> removed the ${what}.`, text: `${whoText} removed the ${what}`, personal: false };
    }
    default:
      return null;
  }
}

/** Subject for one person's batch on one item: personal events lead ("Alice assigned FIXO-12 to you"). */
export function digestSubject(item: { key: string; title: string }, lines: DigestLine[]): string {
  const title = item.title.length > 80 ? `${item.title.slice(0, 77)}…` : item.title;
  if (lines.length === 1) {
    const l = lines[0];
    if (l.personal) return `[${item.key}] ${l.text}: ${title}`;
    return `[${item.key}] ${title} — ${l.text}`;
  }
  return `[${item.key}] ${title} (${lines.length} updates)`;
}

const REASON_FOOTER: Record<NotifyReason, string> = {
  assigned: "You're getting this because the issue was assigned to you.",
  assignee: "You're getting this because you're the assignee.",
  mentioned: "You're getting this because you were mentioned.",
  watching: "You're getting this because you're watching this issue (you reported, were assigned, commented or were mentioned).",
};

/** The email body (inside emailShell): the updates, a button, and why they got it. */
export function digestBodyHtml(o: {
  item: { key: string; title: string; productName: string };
  lines: DigestLine[];
  reason: NotifyReason;
  url: string;
  button: string;
}): string {
  const items = o.lines.map((l) => `<li style="margin:0 0 12px">${l.html}</li>`).join("");
  return `<p style="margin:0 0 4px;color:#8b93b2;font-size:13px">${escapeHtml(o.item.productName)} · ${escapeHtml(o.item.key)}</p>
<p style="margin:0 0 16px;font-size:17px;color:#f2f4fb;font-weight:600">${escapeHtml(o.item.title)}</p>
<ul style="margin:0;padding-left:18px">${items}</ul>
${o.button}
<p style="color:#8b93b2;font-size:12px;margin:16px 0 0">${REASON_FOOTER[o.reason]} Stop watching from the issue's page.</p>`;
}

/** The strongest reason across a batch (personal reasons outrank watching). */
export function strongestReason(reasons: NotifyReason[]): NotifyReason {
  return reasons.includes("assigned") ? "assigned" : reasons.includes("mentioned") ? "mentioned" : reasons.includes("assignee") ? "assignee" : "watching";
}

const PRIORITY_NAMES: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
const FIELD_NAMES: Record<string, string> = { title: "the title", description: "the description", type: "the type", estimatePoints: "the story points", labels: "the labels", dueOn: "the due date", source: "the source" };

/** item_updated's fields → readable pieces ("the title to “X”", "the due date to 2026-11-20"). */
function describeFieldChanges(fields: unknown): { html: string; text: string }[] {
  if (!fields || typeof fields !== "object") return [];
  const out: { html: string; text: string }[] = [];
  for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
    const name = FIELD_NAMES[k];
    if (!name) continue;
    const after = v && typeof v === "object" && "after" in v ? (v as { after: unknown }).after : undefined;
    const shown = typeof after === "string" || typeof after === "number" ? String(after) : Array.isArray(after) ? after.join(", ") : null;
    if (k === "title" && shown) out.push({ html: `${name} to “${escapeHtml(shown)}”`, text: `${name}` });
    else if (shown && k !== "description") out.push({ html: `${name} to ${escapeHtml(shown)}`, text: name });
    else out.push({ html: name, text: name });
  }
  return out;
}
