import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { roleHasWorkAccess } from "../../lib/roles";
import { WORK } from "../../lib/routes";
import { user } from "../auth/schema";
import { products } from "../catalog/schema";
import { formatKey } from "./key-logic";
import {
  NOTIFY_KINDS,
  describeEvent,
  digestBodyHtml,
  digestSubject,
  recipientsFor,
  strongestReason,
  type DigestLine,
  type NotifyEvent,
  type NotifyReason,
} from "./notify-logic";
import { richTextToPlain } from "./rich-text";
import { workBoards, workComments, workItemEvents, workItems, workWatchers } from "./schema";

/** Events per run (the worker runs every minute). */
const BATCH = 500;
/** Let an event settle so a quick follow-up (comment, then a status move) lands in the same email. */
const SETTLE_MS = 30_000;

/**
 * Work email notifications, run by the worker every minute: read item events
 * not yet handled, work out who hears about each (notify-logic), batch one
 * person's updates on one item into one email, send, and mark the events
 * handled. The rows are locked (SKIP LOCKED) so two workers never double-send;
 * a failed send is logged, not retried — these are courtesy emails.
 */
export async function runWorkNotifications(now = new Date()): Promise<{ events: number; emails: number; failed: number }> {
  return db.transaction(async (tx) => {
    const events = await tx
      .select({ id: workItemEvents.id, itemId: workItemEvents.itemId, kind: workItemEvents.kind, actorUserId: workItemEvents.actorUserId, payload: workItemEvents.payload })
      .from(workItemEvents)
      .where(and(isNull(workItemEvents.notifiedAt), lt(workItemEvents.createdAt, new Date(now.getTime() - SETTLE_MS))))
      .orderBy(asc(workItemEvents.createdAt))
      .limit(BATCH)
      .for("update", { skipLocked: true });
    if (!events.length) return { events: 0, emails: 0, failed: 0 };

    const relevant = events.filter((e) => NOTIFY_KINDS.has(e.kind));
    let emails = 0;
    let failed = 0;

    if (relevant.length) {
      const itemIds = [...new Set(relevant.map((e) => e.itemId))];
      const commentIds = [...new Set(relevant.map((e) => e.payload.commentId).filter((x): x is string => typeof x === "string"))];
      const actorIds = [...new Set(relevant.map((e) => e.actorUserId).filter((x): x is string => !!x))];
      // One connection per transaction: these run one after another, not in parallel.
      const items = await tx
          .select({ id: workItems.id, number: workItems.number, title: workItems.title, assigneeUserId: workItems.assigneeUserId, keyPrefix: workBoards.keyPrefix, slug: products.slug, productName: products.name })
          .from(workItems)
          .innerJoin(workBoards, eq(workItems.boardId, workBoards.id))
          .innerJoin(products, eq(workBoards.productId, products.id))
          .where(inArray(workItems.id, itemIds));
      const watchers = await tx.select({ itemId: workWatchers.itemId, userId: workWatchers.userId }).from(workWatchers).where(inArray(workWatchers.itemId, itemIds));
      const comments = commentIds.length
        ? await tx.select({ id: workComments.id, body: workComments.body }).from(workComments).where(inArray(workComments.id, commentIds))
        : [];
      const actors = actorIds.length ? await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, actorIds)) : [];
      const itemById = new Map(items.map((i) => [i.id, i]));
      const watchersOf = new Map<string, string[]>();
      for (const w of watchers) watchersOf.set(w.itemId, [...(watchersOf.get(w.itemId) ?? []), w.userId]);
      const commentText = new Map(comments.map((c) => [c.id, trimForEmail(richTextToPlain(c.body))]));
      const actorName = new Map(actors.map((a) => [a.id, a.name]));

      // recipient → item → { events, reasons }
      const batches = new Map<string, Map<string, { events: NotifyEvent[]; reasons: NotifyReason[] }>>();
      for (const row of relevant) {
        if (!itemById.has(row.itemId)) continue; // item deleted since
        const e: NotifyEvent = { ...row, actorName: row.actorUserId ? (actorName.get(row.actorUserId) ?? null) : null };
        for (const [recipient, reason] of recipientsFor(e, watchersOf.get(row.itemId) ?? [], itemById.get(row.itemId)!.assigneeUserId)) {
          const perItem = batches.get(recipient) ?? new Map();
          const b = perItem.get(row.itemId) ?? { events: [], reasons: [] };
          b.events.push(e);
          b.reasons.push(reason);
          perItem.set(row.itemId, b);
          batches.set(recipient, perItem);
        }
      }

      const recipients = batches.size
        ? await tx
            .select({ id: user.id, email: user.email, role: user.platformRole, disabledAt: user.disabledAt })
            .from(user)
            .where(inArray(user.id, [...batches.keys()]))
        : [];
      for (const r of recipients) {
        // Only people who can still open the work area hear about it.
        if (r.disabledAt || !roleHasWorkAccess(r.role) || !r.email) continue;
        for (const [itemId, b] of batches.get(r.id) ?? []) {
          const item = itemById.get(itemId)!;
          const mentionedInComments = new Set(
            b.events
              .filter((e) => e.kind === "mentioned" && typeof e.payload.commentId === "string" && Array.isArray(e.payload.userIds) && e.payload.userIds.includes(r.id))
              .map((e) => e.payload.commentId as string),
          );
          const lines = b.events.map((e) => describeEvent(e, r.id, { comments: commentText, mentionedInComments })).filter((l): l is DigestLine => !!l);
          if (!lines.length) continue;
          const key = formatKey(item.keyPrefix, item.number);
          const url = `${env.APP_BASE_URL.replace(/\/$/, "")}${WORK.item(item.slug, item.number)}`;
          const html = emailShell(
            `${key} · ${lines.length === 1 ? "Update" : `${lines.length} updates`}`,
            digestBodyHtml({ item: { key, title: item.title, productName: item.productName }, lines, reason: strongestReason(b.reasons), url, button: emailButton(url, "View issue") }),
          );
          const res = await sendEmail({ to: r.email, subject: digestSubject({ key, title: item.title }, lines), html });
          if (res.sent || res.error === "RESEND_API_KEY not configured") emails++;
          else failed++;
        }
      }
    }

    await tx.update(workItemEvents).set({ notifiedAt: now }).where(inArray(workItemEvents.id, events.map((e) => e.id)));
    return { events: events.length, emails, failed };
  });
}

function trimForEmail(s: string): string {
  return s.length > 600 ? `${s.slice(0, 597)}…` : s;
}
