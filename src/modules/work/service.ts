import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { isoDay } from "../../lib/dates";
import { roleHasWorkAccess } from "../../lib/roles";
import { organization, user } from "../auth/schema";
import { products } from "../catalog/schema";
import type { BoardSettings, CarryOver, CreateItem, ItemPatch, WorkItemStatus, WorkLinkType, WorkResolution } from "./contracts";
import { defaultKeyPrefix, formatKey, uniqueKeyPrefix } from "./key-logic";
import { RANK_REBALANCE_AT, rankBetween, rebalanceRanks } from "./rank-logic";
import { attachmentProblem, fileAttachmentType, sniffImageType } from "./attachment-logic";
import { cloneTitle, linkPhrase, linkRow, type LinkDirection } from "./link-logic";
import { normalizeRichText } from "./rich-text-sanitize";
import { richTextToPlain } from "./rich-text";
import { extractMentionIds, newMentionIds } from "./mention-logic";
import { workAttachments, workBoards, workComments, workItemAliases, workItemEvents, workItemLinks, workItems, workNotifications, workSprints, workWatchers } from "./schema";
import { NOTIFY_KINDS, recipientsFor } from "./notify-logic";
import { addDays, carryOverPatch, isClosedStatus, nextSprintWindow, sprintCommitment, sprintCompletion } from "./sprint-logic";
import { applyTransition, blockedReason, canTransition, sprintForTransition, statusForSprintChange } from "./transitions";

/**
 * The only writer for the work module. Every mutation runs in one
 * transaction and leaves a work_item_events row; permission checks live in
 * actions.ts (policy), state checks live here.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BoardRow = typeof workBoards.$inferSelect;
type ItemRow = typeof workItems.$inferSelect;
type SprintRow = typeof workSprints.$inferSelect;
type UserRef = { id: string; name: string };

const ref = (u: { id: string; name: string } | null | undefined): UserRef | null => (u ? { id: u.id, name: u.name } : null);
const sprintRef = (s: { id: string; name: string } | null | undefined) => (s ? { id: s.id, name: s.name } : null);

function isUniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = err?.code ?? err?.cause?.code;
  const name = err?.constraint ?? err?.cause?.constraint;
  return code === "23505" && (name === constraint || name === undefined);
}

async function recordEvent(
  tx: Tx,
  e: { itemId: string; actorUserId: string | null; kind: string; payload?: Record<string, unknown> },
): Promise<void> {
  const [row] = await tx
    .insert(workItemEvents)
    .values({
      itemId: e.itemId,
      actorUserId: e.actorUserId,
      kind: e.kind,
      payload: e.payload ?? {},
    })
    .returning({ id: workItemEvents.id });
  await notifyInApp(tx, { id: row.id, itemId: e.itemId, actorUserId: e.actorUserId, kind: e.kind, payload: e.payload ?? {} });
}

/**
 * The bell: one unread row per person who should hear about this event — the
 * same people the emails go to (recipientsFor), written right away. Comments
 * and description mentions carry their first words.
 */
async function notifyInApp(tx: Tx, e: { id: string; itemId: string; actorUserId: string | null; kind: string; payload: Record<string, unknown> }) {
  if (!NOTIFY_KINDS.has(e.kind)) return;
  const [watchers, item] = await Promise.all([
    tx.select({ userId: workWatchers.userId }).from(workWatchers).where(eq(workWatchers.itemId, e.itemId)),
    tx.query.workItems.findFirst({ where: eq(workItems.id, e.itemId), columns: { assigneeUserId: true } }),
  ]);
  const who = recipientsFor({ ...e, actorName: null }, watchers.map((w) => w.userId), item?.assigneeUserId ?? null);
  if (who.size === 0) return;
  let excerpt: string | null = typeof e.payload.excerpt === "string" ? e.payload.excerpt : null;
  if (e.kind === "comment_added" && typeof e.payload.commentId === "string") {
    const c = await tx.query.workComments.findFirst({ where: eq(workComments.id, e.payload.commentId), columns: { body: true } });
    excerpt = c ? richTextToPlain(c.body) : null;
  }
  await tx.insert(workNotifications).values(
    [...who].map(([userId, reason]) => ({
      userId,
      itemId: e.itemId,
      eventId: e.id,
      kind: e.kind,
      reason,
      actorUserId: e.actorUserId,
      payload: e.payload,
      excerpt: excerpt ? excerpt.replace(/\s+/g, " ").trim().slice(0, 200) : null,
    })),
  );
}

/** Add people to an item's watchers (idempotent). */
async function addWatchers(tx: Tx, itemId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length) await tx.insert(workWatchers).values(ids.map((userId) => ({ itemId, userId }))).onConflictDoNothing();
}

/** Of these user ids, the ones who can use the work area (mentions of anyone else are ignored). */
async function workUsersAmong(tx: Tx, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.select({ id: user.id, role: user.platformRole, disabledAt: user.disabledAt }).from(user).where(inArray(user.id, ids));
  return rows.filter((r) => !r.disabledAt && roleHasWorkAccess(r.role)).map((r) => r.id);
}

/** Record who was @mentioned (comment or description) and make them watchers. */
async function recordMentions(tx: Tx, o: { itemId: string; actorUserId: string | null; userIds: string[]; commentId?: string; html: string }) {
  const ids = (await workUsersAmong(tx, o.userIds)).filter((id) => id !== o.actorUserId);
  if (!ids.length) return;
  await addWatchers(tx, o.itemId, ids);
  const excerpt = o.commentId ? undefined : richTextToPlain(o.html).slice(0, 500);
  await recordEvent(tx, { itemId: o.itemId, actorUserId: o.actorUserId, kind: "mentioned", payload: { userIds: ids, ...(o.commentId ? { commentId: o.commentId } : { excerpt }) } });
}

async function boardContext(tx: Tx, boardId: string) {
  const [row] = await tx
    .select({ board: workBoards, productSlug: products.slug })
    .from(workBoards)
    .innerJoin(products, eq(workBoards.productId, products.id))
    .where(eq(workBoards.id, boardId))
    .limit(1);
  if (!row) throw new Error("Board not found");
  const activeSprint =
    (await tx.query.workSprints.findFirst({
      where: and(eq(workSprints.boardId, boardId), eq(workSprints.status, "active")),
    })) ?? null;
  return { board: row.board, productSlug: row.productSlug, activeSprint };
}

async function itemContext(tx: Tx, itemId: string, lock = false) {
  const q = tx.select().from(workItems).where(eq(workItems.id, itemId)).limit(1);
  const [item] = lock ? await q.for("update") : await q;
  if (!item) throw new Error("Item not found");
  const ctx = await boardContext(tx, item.boardId);
  return { item, ...ctx, key: formatKey(ctx.board.keyPrefix, item.number) };
}

/** Rank that appends to the end of a column. */
async function appendRank(tx: Tx, boardId: string, status: WorkItemStatus, excludeId?: string): Promise<string> {
  const conds = [eq(workItems.boardId, boardId), eq(workItems.status, status)];
  if (excludeId) conds.push(ne(workItems.id, excludeId));
  const [last] = await tx
    .select({ rank: workItems.rank })
    .from(workItems)
    .where(and(...conds))
    .orderBy(desc(workItems.rank))
    .limit(1);
  return rankBetween(last?.rank ?? null, null);
}

async function assertAssignable(tx: Tx, userId: string): Promise<UserRef> {
  const u = await tx.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true, name: true, platformRole: true },
  });
  if (!u || !roleHasWorkAccess(u.platformRole)) throw new Error("Only developers and ops can be assigned work");
  return { id: u.id, name: u.name };
}

async function sprintOnBoard(tx: Tx, sprintId: string, boardId: string): Promise<SprintRow> {
  const s = await tx.query.workSprints.findFirst({ where: and(eq(workSprints.id, sprintId), eq(workSprints.boardId, boardId)) });
  if (!s) throw new Error("Sprint not found on this board");
  return s;
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** The product's board, created on first use with a prefix derived from the slug. */
export async function ensureBoard(productId: string): Promise<BoardRow> {
  const existing = await db.query.workBoards.findFirst({ where: eq(workBoards.productId, productId) });
  if (existing) return existing;
  const product = await db.query.products.findFirst({ where: eq(products.id, productId), columns: { slug: true } });
  if (!product) throw new Error("Product not found");
  const taken = new Set((await db.select({ k: workBoards.keyPrefix }).from(workBoards)).map((r) => r.k));
  const keyPrefix = uniqueKeyPrefix(defaultKeyPrefix(product.slug), taken);
  const [created] = await db.insert(workBoards).values({ productId, keyPrefix }).onConflictDoNothing().returning();
  const board = created ?? (await db.query.workBoards.findFirst({ where: eq(workBoards.productId, productId) }));
  if (!board) throw new Error("Board could not be created — try again");
  return board;
}

export async function ensureBoardForProductSlug(slug: string): Promise<{ board: BoardRow; productId: string } | null> {
  const product = await db.query.products.findFirst({ where: eq(products.slug, slug), columns: { id: true } });
  if (!product) return null;
  return { board: await ensureBoard(product.id), productId: product.id };
}

/** `reportAssigneeUserId` left out keeps the current one; null clears it. */
export async function updateBoardSettings(
  o: Omit<BoardSettings, "reportAssigneeUserId"> & { reportAssigneeUserId?: string | null; actorUserId: string },
): Promise<{ productSlug: string }> {
  return db.transaction(async (tx) => {
    const { board, productSlug, activeSprint } = await boardContext(tx, o.boardId);
    if (o.keyPrefix !== board.keyPrefix) {
      const clash = await tx.query.workBoards.findFirst({ where: eq(workBoards.keyPrefix, o.keyPrefix), columns: { id: true } });
      if (clash) throw new Error(`Key prefix ${o.keyPrefix} is already used by another board`);
    }
    if (o.mode === "kanban" && board.mode === "sprints" && activeSprint) {
      throw new Error("Complete the active sprint before switching this board to kanban");
    }
    if (o.reportAssigneeUserId) await assertAssignable(tx, o.reportAssigneeUserId);
    await tx
      .update(workBoards)
      .set({ keyPrefix: o.keyPrefix, mode: o.mode, sprintLengthDays: o.sprintLengthDays, wipLimits: o.wipLimits, ...(o.reportAssigneeUserId !== undefined ? { reportAssigneeUserId: o.reportAssigneeUserId } : {}) })
      .where(eq(workBoards.id, o.boardId));
    console.log(`[work] board ${board.keyPrefix} settings updated by ${o.actorUserId}`);
    return { productSlug };
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function createItem(
  o: CreateItem & {
    reporterUserId: string | null;
    requesterTenantId?: string | null;
    /** Filed by a partner app with no Hub user behind it ("Fixorata"): named on the events in place of an actor. */
    via?: string;
  },
): Promise<{ id: string; number: number; key: string; productSlug: string }> {
  return db.transaction(async (tx) => {
    // Claim the number: the row lock serialises concurrent creates on one board.
    const [claim] = await tx
      .update(workBoards)
      .set({ nextItemNumber: sql`${workBoards.nextItemNumber} + 1` })
      .where(eq(workBoards.id, o.boardId))
      .returning({ next: workBoards.nextItemNumber });
    if (!claim) throw new Error("Board not found");
    const number = claim.next - 1;
    const { board, productSlug, activeSprint } = await boardContext(tx, o.boardId);

    let sprint: SprintRow | null = null;
    if (o.sprintId) {
      sprint = await sprintOnBoard(tx, o.sprintId, o.boardId);
      if (sprint.status === "completed") throw new Error("That sprint is already completed");
    }
    let status: WorkItemStatus = o.status;
    if (sprint) status = statusForSprintChange({ status, nextSprintId: sprint.id });
    const sprintId = sprint
      ? sprint.id
      : sprintForTransition({ mode: board.mode, to: status, currentSprintId: null, activeSprintId: activeSprint?.id ?? null });
    if (!sprint && sprintId) sprint = activeSprint;

    const assignee = o.assigneeUserId ? await assertAssignable(tx, o.assigneeUserId) : null;
    const parent = o.parentId ? await assertEpicParent(tx, { parentId: o.parentId, boardId: o.boardId, childType: o.type }) : null;
    let requester: { id: string; name: string } | null = null;
    if (o.requesterTenantId) {
      const org = await tx.query.organization.findFirst({ where: eq(organization.id, o.requesterTenantId), columns: { id: true, name: true } });
      if (!org) throw new Error("Workspace not found");
      requester = org;
    }

    const now = new Date();
    const stamps = applyTransition({ startedAt: null, completedAt: null }, status, now);
    const [item] = await tx
      .insert(workItems)
      .values({
        boardId: o.boardId,
        number,
        type: o.type,
        title: o.title,
        description: normalizeRichText(o.description),
        status,
        priority: o.priority,
        rank: await appendRank(tx, o.boardId, status),
        estimatePoints: o.estimatePoints ?? null,
        assigneeUserId: assignee?.id ?? null,
        reporterUserId: o.reporterUserId,
        sprintId,
        source: o.source,
        requesterTenantId: requester?.id ?? null,
        labels: o.labels,
        dueOn: o.dueOn ?? null,
        parentId: parent?.id ?? null,
        ...stamps,
      })
      .returning({ id: workItems.id });

    const actor = o.reporterUserId;
    const via = o.via ? { via: o.via } : {};
    await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "item_created", payload: { title: o.title, type: o.type, priority: o.priority, status, ...via } });
    if (assignee) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "assignee_changed", payload: { before: null, after: assignee, ...via } });
    if (sprint && sprintId) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "sprint_changed", payload: { before: null, after: sprintRef(sprint), reason: o.sprintId ? "sprint_assigned" : undefined, ...via } });
    // The requester is its own (ops-only) event so item_created never names a client.
    if (requester) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "requester_changed", payload: { before: null, after: requester, ...via } });
    if (parent) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "parent_changed", payload: { before: null, after: epicRef(parent, board.keyPrefix), ...via } });
    await addWatchers(tx, item.id, [actor, assignee?.id]);
    const description = normalizeRichText(o.description);
    await recordMentions(tx, { itemId: item.id, actorUserId: actor, userIds: extractMentionIds(description), html: description });

    return { id: item.id, number, key: formatKey(board.keyPrefix, number), productSlug };
  });
}

export async function updateItem(o: { itemId: string; patch: ItemPatch; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    const set: Partial<ItemRow> = {};
    const fields: Record<string, unknown> = {};
    const p = o.patch;
    if (p.title !== undefined && p.title !== item.title) {
      set.title = p.title;
      fields.title = { before: item.title, after: p.title };
    }
    const description = p.description === undefined ? undefined : normalizeRichText(p.description);
    if (description !== undefined && description !== item.description) {
      set.description = description;
      fields.description = { changed: true };
      await recordMentions(tx, { itemId: item.id, actorUserId: o.actorUserId, userIds: newMentionIds(item.description, description), html: description });
    }
    if (p.type !== undefined && p.type !== item.type) {
      set.type = p.type;
      // An epic has no epic of its own; an item that stops being an epic releases its children.
      if (p.type === "epic") set.parentId = null;
      if (item.type === "epic") await tx.update(workItems).set({ parentId: null }).where(eq(workItems.parentId, item.id));
      fields.type = { before: item.type, after: p.type };
    }
    if (p.estimatePoints !== undefined && p.estimatePoints !== item.estimatePoints) {
      set.estimatePoints = p.estimatePoints;
      fields.estimatePoints = { before: item.estimatePoints, after: p.estimatePoints };
    }
    if (p.labels !== undefined && JSON.stringify(p.labels) !== JSON.stringify(item.labels)) {
      set.labels = p.labels;
      fields.labels = { before: item.labels, after: p.labels };
    }
    if (p.dueOn !== undefined && p.dueOn !== item.dueOn) {
      set.dueOn = p.dueOn;
      fields.dueOn = { before: item.dueOn, after: p.dueOn };
    }
    if (p.source !== undefined && p.source !== item.source) {
      set.source = p.source;
      fields.source = { before: item.source, after: p.source };
    }
    const priorityChanged = p.priority !== undefined && p.priority !== item.priority;
    if (priorityChanged) set.priority = p.priority;

    if (Object.keys(set).length === 0) return { productSlug, number: item.number };
    await tx.update(workItems).set(set).where(eq(workItems.id, item.id));
    if (Object.keys(fields).length) await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "item_updated", payload: { fields } });
    if (priorityChanged) await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "priority_changed", payload: { before: item.priority, after: p.priority } });
    return { productSlug, number: item.number };
  });
}

/**
 * Move a card to a column position. `prevId`/`nextId` are the cards around
 * the drop point as the client saw them; a neighbour that has since moved
 * elsewhere is ignored (the card still lands near the intended spot), and a
 * rank that has grown long triggers a column rebalance.
 */
export async function moveItem(o: {
  itemId: string;
  status: WorkItemStatus;
  prevId?: string | null;
  nextId?: string | null;
  actorUserId: string;
  /** Moving to Done: how it was resolved (defaults to "done"). */
  resolution?: WorkResolution;
  /** Placement at creation (inline create into any column) isn't a transition: skip the workflow check. */
  placement?: boolean;
}): Promise<{ rank: string; status: WorkItemStatus; sprintId: string | null; productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, board, productSlug, activeSprint } = await itemContext(tx, o.itemId, true);
    const statusChanged = item.status !== o.status;
    if (statusChanged && !o.placement && !canTransition(item.status, o.status)) throw new Error(blockedReason(item.status, o.status));

    const ids = [o.prevId, o.nextId].filter((x): x is string => !!x && x !== item.id);
    const neighbours = ids.length
      ? await tx
          .select({ id: workItems.id, rank: workItems.rank })
          .from(workItems)
          .where(and(inArray(workItems.id, ids), eq(workItems.boardId, item.boardId), eq(workItems.status, o.status)))
      : [];
    const prevRank = neighbours.find((n) => n.id === o.prevId)?.rank ?? null;
    const nextRank = neighbours.find((n) => n.id === o.nextId)?.rank ?? null;

    let rank: string;
    if (prevRank === null && nextRank === null) {
      rank = !statusChanged && !o.prevId && !o.nextId ? item.rank : await appendRank(tx, item.boardId, o.status, item.id);
    } else if (prevRank !== null && nextRank !== null && prevRank >= nextRank) {
      rank = await appendRank(tx, item.boardId, o.status, item.id);
    } else {
      rank = rankBetween(prevRank, nextRank);
    }

    if (rank.length > RANK_REBALANCE_AT) {
      const column = await tx
        .select({ id: workItems.id, rank: workItems.rank })
        .from(workItems)
        .where(and(eq(workItems.boardId, item.boardId), eq(workItems.status, o.status), ne(workItems.id, item.id)))
        .orderBy(asc(workItems.rank), asc(workItems.createdAt))
        .for("update");
      const position = column.filter((c) => c.rank < rank).length;
      const ordered = [...column.slice(0, position).map((c) => c.id), item.id, ...column.slice(position).map((c) => c.id)];
      const keys = rebalanceRanks(ordered.length);
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i] === item.id) rank = keys[i];
        else await tx.update(workItems).set({ rank: keys[i] }).where(eq(workItems.id, ordered[i]));
      }
    }

    const now = new Date();
    const stamps = statusChanged ? applyTransition(item, o.status, now) : {};
    const sprintId = statusChanged
      ? sprintForTransition({ mode: board.mode, to: o.status, currentSprintId: item.sprintId, activeSprintId: activeSprint?.id ?? null })
      : item.sprintId;
    const resolution = o.status === "done" ? (o.resolution ?? "done") : null;
    await tx
      .update(workItems)
      .set({ status: o.status, rank, sprintId, ...stamps, ...(statusChanged ? { resolution } : {}) })
      .where(eq(workItems.id, item.id));

    if (statusChanged) {
      await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "status_changed", payload: { before: item.status, after: o.status, ...(resolution ? { resolution } : {}) } });
      if (sprintId !== item.sprintId) {
        const before = item.sprintId ? await tx.query.workSprints.findFirst({ where: eq(workSprints.id, item.sprintId), columns: { id: true, name: true } }) : null;
        const after = sprintId === activeSprint?.id ? activeSprint : null;
        await recordEvent(tx, {
          itemId: item.id,
          actorUserId: o.actorUserId,
          kind: "sprint_changed",
          payload: { before: sprintRef(before), after: sprintRef(after), reason: sprintId ? "sprint_assigned" : "sprint_removed" },
        });
      }
    }
    return { rank, status: o.status, sprintId, productSlug, number: item.number };
  });
}

export async function assignItem(o: { itemId: string; assigneeUserId: string | null; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    if ((o.assigneeUserId ?? null) === item.assigneeUserId) return { productSlug, number: item.number };
    const after = o.assigneeUserId ? await assertAssignable(tx, o.assigneeUserId) : null;
    const before = item.assigneeUserId
      ? ref(await tx.query.user.findFirst({ where: eq(user.id, item.assigneeUserId), columns: { id: true, name: true } }))
      : null;
    await tx.update(workItems).set({ assigneeUserId: after?.id ?? null }).where(eq(workItems.id, item.id));
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "assignee_changed", payload: { before, after } });
    await addWatchers(tx, item.id, [after?.id]);
    return { productSlug, number: item.number };
  });
}

export async function setItemSprint(o: { itemId: string; sprintId: string | null; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId, true);
    if ((o.sprintId ?? null) === item.sprintId) return { productSlug, number: item.number };
    const after = o.sprintId ? await sprintOnBoard(tx, o.sprintId, item.boardId) : null;
    if (after?.status === "completed") throw new Error("That sprint is already completed");
    const before = item.sprintId ? await tx.query.workSprints.findFirst({ where: eq(workSprints.id, item.sprintId), columns: { id: true, name: true } }) : null;

    const status = statusForSprintChange({ status: item.status, nextSprintId: after?.id ?? null });
    const statusChanged = status !== item.status;
    const set: Partial<ItemRow> = { sprintId: after?.id ?? null };
    if (statusChanged) {
      Object.assign(set, applyTransition(item, status, new Date()), { status, rank: await appendRank(tx, item.boardId, status, item.id) });
    }
    await tx.update(workItems).set(set).where(eq(workItems.id, item.id));
    const reason = after ? "sprint_assigned" : "sprint_removed";
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "sprint_changed", payload: { before: sprintRef(before), after: sprintRef(after), reason } });
    if (statusChanged) await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "status_changed", payload: { before: item.status, after: status, reason } });
    return { productSlug, number: item.number };
  });
}

/** Ops only: which client asked for this. */
export async function setItemRequester(o: { itemId: string; requesterTenantId: string | null; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    if ((o.requesterTenantId ?? null) === item.requesterTenantId) return { productSlug, number: item.number };
    const lookup = async (id: string | null) =>
      id ? ((await tx.query.organization.findFirst({ where: eq(organization.id, id), columns: { id: true, name: true } })) ?? null) : null;
    const after = await lookup(o.requesterTenantId);
    if (o.requesterTenantId && !after) throw new Error("Workspace not found");
    const before = await lookup(item.requesterTenantId);
    await tx.update(workItems).set({ requesterTenantId: after?.id ?? null }).where(eq(workItems.id, item.id));
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "requester_changed", payload: { before, after } });
    return { productSlug, number: item.number };
  });
}

export async function deleteItem(o: { itemId: string; actorUserId: string }): Promise<{ productSlug: string }> {
  return db.transaction(async (tx) => {
    const { item, productSlug, key } = await itemContext(tx, o.itemId);
    await tx.delete(workItems).where(eq(workItems.id, item.id));
    console.log(`[work] ${key} "${item.title}" deleted by ${o.actorUserId}`);
    return { productSlug };
  });
}

// ---------------------------------------------------------------------------
// Comments — the author or ops may edit/delete
// ---------------------------------------------------------------------------

export async function addComment(o: { itemId: string; body: string; authorUserId: string; parentId?: string | null }): Promise<{ commentId: string; productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    const body = commentBody(o.body);
    // A reply hangs off the thread's top-level comment (one level, like Jira).
    let parent: { id: string; authorUserId: string | null } | null = null;
    if (o.parentId) {
      const p = await tx.query.workComments.findFirst({ where: eq(workComments.id, o.parentId), columns: { id: true, itemId: true, parentCommentId: true, authorUserId: true } });
      if (!p || p.itemId !== item.id) throw new Error("That comment isn't on this item");
      parent = p.parentCommentId
        ? ((await tx.query.workComments.findFirst({ where: eq(workComments.id, p.parentCommentId), columns: { id: true, authorUserId: true } })) ?? { id: p.id, authorUserId: p.authorUserId })
        : { id: p.id, authorUserId: p.authorUserId };
      // The person being answered is the author of the comment clicked, even inside a thread.
      parent = { id: parent.id, authorUserId: p.authorUserId };
    }
    const [c] = await tx.insert(workComments).values({ itemId: item.id, authorUserId: o.authorUserId, body, parentCommentId: parent?.id ?? null }).returning({ id: workComments.id });
    const replyTo = parent?.authorUserId && parent.authorUserId !== o.authorUserId ? parent.authorUserId : null;
    await recordEvent(tx, { itemId: item.id, actorUserId: o.authorUserId, kind: "comment_added", payload: { commentId: c.id, ...(replyTo ? { replyToUserId: replyTo } : {}) } });
    await addWatchers(tx, item.id, [o.authorUserId]);
    await recordMentions(tx, { itemId: item.id, actorUserId: o.authorUserId, userIds: extractMentionIds(body), commentId: c.id, html: body });
    return { commentId: c.id, productSlug, number: item.number };
  });
}

async function ownedComment(tx: Tx, commentId: string, actorUserId: string, actorIsOps: boolean) {
  const c = await tx.query.workComments.findFirst({ where: eq(workComments.id, commentId) });
  if (!c) throw new Error("Comment not found");
  if (!actorIsOps && c.authorUserId !== actorUserId) throw new Error("Only the author or ops can change this comment");
  return c;
}

export async function editComment(o: { commentId: string; body: string; actorUserId: string; actorIsOps: boolean }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const c = await ownedComment(tx, o.commentId, o.actorUserId, o.actorIsOps);
    const { item, productSlug } = await itemContext(tx, c.itemId);
    const body = commentBody(o.body);
    await tx.update(workComments).set({ body, editedAt: new Date() }).where(eq(workComments.id, c.id));
    await recordMentions(tx, { itemId: item.id, actorUserId: o.actorUserId, userIds: newMentionIds(c.body, body), commentId: c.id, html: body });
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "comment_edited", payload: { commentId: c.id } });
    return { productSlug, number: item.number };
  });
}

export async function deleteComment(o: { commentId: string; actorUserId: string; actorIsOps: boolean }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const c = await ownedComment(tx, o.commentId, o.actorUserId, o.actorIsOps);
    const { item, productSlug } = await itemContext(tx, c.itemId);
    await tx.delete(workComments).where(eq(workComments.id, c.id));
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "comment_deleted", payload: { commentId: c.id } });
    return { productSlug, number: item.number };
  });
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

async function createSprintTx(
  tx: Tx,
  board: BoardRow,
  o: { name?: string; goal?: string | null; startsOn?: string; endsOn?: string },
): Promise<SprintRow> {
  if (board.mode !== "sprints") throw new Error("Switch this board to sprints mode first (Settings)");
  const [claim] = await tx
    .update(workBoards)
    .set({ nextSprintNumber: sql`${workBoards.nextSprintNumber} + 1` })
    .where(eq(workBoards.id, board.id))
    .returning({ next: workBoards.nextSprintNumber });
  const number = claim.next - 1;
  const [latest] = await tx
    .select({ endsOn: workSprints.endsOn })
    .from(workSprints)
    .where(eq(workSprints.boardId, board.id))
    .orderBy(desc(workSprints.endsOn))
    .limit(1);
  const window = nextSprintWindow({ lengthDays: board.sprintLengthDays, previousEndsOn: latest?.endsOn ?? null, today: isoDay() });
  const startsOn = o.startsOn ?? window.startsOn;
  const endsOn = o.endsOn ?? addDays(startsOn, board.sprintLengthDays - 1);
  if (endsOn < startsOn) throw new Error("The sprint must end on or after it starts");
  const [sprint] = await tx
    .insert(workSprints)
    .values({ boardId: board.id, number, name: o.name?.trim() || `Sprint ${number}`, goal: o.goal ?? null, startsOn, endsOn })
    .returning();
  return sprint;
}

export async function createSprint(o: {
  boardId: string;
  name?: string;
  goal?: string | null;
  startsOn?: string;
  endsOn?: string;
  actorUserId: string;
}): Promise<{ sprintId: string; number: number; productSlug: string }> {
  return db.transaction(async (tx) => {
    const { board, productSlug } = await boardContext(tx, o.boardId);
    const s = await createSprintTx(tx, board, o);
    return { sprintId: s.id, number: s.number, productSlug };
  });
}

export async function updateSprint(o: {
  sprintId: string;
  name?: string;
  goal?: string | null;
  startsOn?: string;
  endsOn?: string;
  actorUserId: string;
}): Promise<{ productSlug: string }> {
  return db.transaction(async (tx) => {
    const s = await tx.query.workSprints.findFirst({ where: eq(workSprints.id, o.sprintId) });
    if (!s) throw new Error("Sprint not found");
    const { productSlug } = await boardContext(tx, s.boardId);
    if (s.status === "completed" && (o.startsOn || o.endsOn)) throw new Error("A completed sprint keeps its dates");
    const startsOn = o.startsOn ?? s.startsOn;
    const endsOn = o.endsOn ?? s.endsOn;
    if (endsOn < startsOn) throw new Error("The sprint must end on or after it starts");
    await tx
      .update(workSprints)
      .set({ name: o.name?.trim() || s.name, goal: o.goal === undefined ? s.goal : o.goal, startsOn, endsOn })
      .where(eq(workSprints.id, s.id));
    return { productSlug };
  });
}

export async function startSprint(o: { sprintId: string; actorUserId: string }): Promise<{ productSlug: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx.select().from(workSprints).where(eq(workSprints.id, o.sprintId)).for("update");
      if (!s) throw new Error("Sprint not found");
      if (s.status !== "planned") throw new Error(`This sprint is ${s.status}`);
      const { productSlug } = await boardContext(tx, s.boardId);
      const items = await tx
        .select({ estimatePoints: workItems.estimatePoints, status: workItems.status })
        .from(workItems)
        .where(eq(workItems.sprintId, s.id));
      const commitment = sprintCommitment(items);
      await tx
        .update(workSprints)
        .set({ status: "active", startedAt: new Date(), ...commitment })
        .where(eq(workSprints.id, s.id));
      return { productSlug };
    });
  } catch (e) {
    if (isUniqueViolation(e, "work_sprints_active_uidx")) throw new Error("Another sprint is already active on this board");
    throw e;
  }
}

/**
 * Close the active sprint: snapshot what got done, then carry every
 * unfinished item to the next planned sprint (creating one when needed) or
 * back to the backlog / unscheduled work. Done and canceled items keep the
 * sprint for the report.
 */
export async function completeSprint(o: { sprintId: string; carryOver: CarryOver; actorUserId: string }): Promise<{
  nextSprintId: string | null;
  carried: number;
  completedPoints: number;
  completedCount: number;
  productSlug: string;
}> {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(workSprints).where(eq(workSprints.id, o.sprintId)).for("update");
    if (!s) throw new Error("Sprint not found");
    if (s.status !== "active") throw new Error(`This sprint is ${s.status}`);
    const { board, productSlug } = await boardContext(tx, s.boardId);
    const items = await tx.select().from(workItems).where(eq(workItems.sprintId, s.id));
    const completion = sprintCompletion(items);
    const unfinished = items.filter((i) => !isClosedStatus(i.status));

    let next: SprintRow | null = null;
    if (o.carryOver === "next" && unfinished.length > 0) {
      next =
        (await tx.query.workSprints.findFirst({
          where: and(eq(workSprints.boardId, s.boardId), eq(workSprints.status, "planned")),
          orderBy: [asc(workSprints.startsOn), asc(workSprints.number)],
        })) ?? (await createSprintTx(tx, board, {}));
    }

    const now = new Date();
    for (const item of unfinished) {
      const patch = carryOverPatch(item, o.carryOver, next?.id ?? null);
      const set: Partial<ItemRow> = { sprintId: patch.sprintId };
      if (patch.status !== item.status) {
        Object.assign(set, applyTransition(item, patch.status, now), { status: patch.status, rank: await appendRank(tx, item.boardId, patch.status, item.id) });
      }
      await tx.update(workItems).set(set).where(eq(workItems.id, item.id));
      await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "sprint_changed", payload: { before: sprintRef(s), after: sprintRef(next), reason: "carry_over" } });
      if (patch.status !== item.status) {
        await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "status_changed", payload: { before: item.status, after: patch.status, reason: "carry_over" } });
      }
    }

    await tx
      .update(workSprints)
      .set({ status: "completed", completedAt: now, ...completion })
      .where(eq(workSprints.id, s.id));
    return { nextSprintId: next?.id ?? null, carried: unfinished.length, ...completion, productSlug };
  });
}

/** Only a planned sprint can be deleted; its items return to the backlog / unscheduled work. */
export async function deleteSprint(o: { sprintId: string; actorUserId: string }): Promise<{ productSlug: string }> {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(workSprints).where(eq(workSprints.id, o.sprintId)).for("update");
    if (!s) throw new Error("Sprint not found");
    if (s.status !== "planned") throw new Error("Only a planned sprint can be deleted");
    const { productSlug } = await boardContext(tx, s.boardId);
    const items = await tx.select().from(workItems).where(eq(workItems.sprintId, s.id));
    const now = new Date();
    for (const item of items) {
      const status = statusForSprintChange({ status: item.status, nextSprintId: null });
      const set: Partial<ItemRow> = { sprintId: null };
      if (status !== item.status) {
        Object.assign(set, applyTransition(item, status, now), { status, rank: await appendRank(tx, item.boardId, status, item.id) });
      }
      await tx.update(workItems).set(set).where(eq(workItems.id, item.id));
      await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "sprint_changed", payload: { before: sprintRef(s), after: null, reason: "sprint_deleted" } });
      if (status !== item.status) {
        await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "status_changed", payload: { before: item.status, after: status, reason: "sprint_deleted" } });
      }
    }
    await tx.delete(workSprints).where(eq(workSprints.id, s.id));
    return { productSlug };
  });
}

// ---------------------------------------------------------------------------
// Rich text + attachments
// ---------------------------------------------------------------------------

/** A comment must say something (text, an image or a checkbox) once sanitised. */
function commentBody(body: string): string {
  const clean = normalizeRichText(body);
  if (!clean) throw new Error("Write something first");
  return clean;
}

/** Store a pasted/uploaded image; the type comes from its bytes. Returns the new attachment id. */
export async function addAttachment(o: { bytes: Uint8Array; fileName: string | null; uploadedByUserId: string | null }): Promise<{ id: string }> {
  const type = sniffImageType(o.bytes);
  const problem = attachmentProblem(o.bytes.byteLength, type);
  if (problem || !type) throw new Error(problem ?? "Unsupported file");
  const [row] = await db
    .insert(workAttachments)
    .values({
      uploadedByUserId: o.uploadedByUserId,
      contentType: type,
      byteSize: o.bytes.byteLength,
      fileName: o.fileName?.slice(0, 200) ?? null,
      data: Buffer.from(o.bytes),
    })
    .returning({ id: workAttachments.id });
  return { id: row.id };
}

/** Jira's flag: mark an item as impeded (with an optional reason) or clear it. Both land in the history. */
export async function setItemFlag(o: { itemId: string; flagged: boolean; reason?: string; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    const reason = o.reason?.trim() || null;
    if (o.flagged === (item.flaggedAt != null) && (!o.flagged || reason === item.flagReason)) return { productSlug, number: item.number };
    await tx
      .update(workItems)
      .set(o.flagged ? { flaggedAt: new Date(), flaggedByUserId: o.actorUserId, flagReason: reason } : { flaggedAt: null, flaggedByUserId: null, flagReason: null })
      .where(eq(workItems.id, item.id));
    await recordEvent(tx, {
      itemId: item.id,
      actorUserId: o.actorUserId,
      kind: o.flagged ? "flag_added" : "flag_removed",
      payload: o.flagged && reason ? { reason } : {},
    });
    return { productSlug, number: item.number };
  });
}

/** Epic links: the parent must be an epic on the same board, and an epic can't have one. */
async function assertEpicParent(tx: Tx, o: { parentId: string; boardId: string; childType: string; childId?: string }) {
  if (o.childType === "epic") throw new Error("An epic can't belong to another epic");
  if (o.childId && o.childId === o.parentId) throw new Error("An item can't be its own epic");
  const parent = await tx.query.workItems.findFirst({ where: eq(workItems.id, o.parentId), columns: { id: true, number: true, title: true, type: true, boardId: true } });
  if (!parent || parent.boardId !== o.boardId) throw new Error("That epic isn't on this board");
  if (parent.type !== "epic") throw new Error("Only an epic can be a parent");
  return parent;
}

const epicRef = (e: { id: string; number: number; title: string }, keyPrefix: string) => ({ id: e.id, name: `${formatKey(keyPrefix, e.number)} ${e.title}` });

/** Put an item under an epic (or take it out). */
export async function setItemParent(o: { itemId: string; parentId: string | null; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, board, productSlug } = await itemContext(tx, o.itemId);
    if ((o.parentId ?? null) === item.parentId) return { productSlug, number: item.number };
    const after = o.parentId ? await assertEpicParent(tx, { parentId: o.parentId, boardId: item.boardId, childType: item.type, childId: item.id }) : null;
    const before = item.parentId ? await tx.query.workItems.findFirst({ where: eq(workItems.id, item.parentId), columns: { id: true, number: true, title: true } }) : null;
    await tx.update(workItems).set({ parentId: after?.id ?? null }).where(eq(workItems.id, item.id));
    await recordEvent(tx, {
      itemId: item.id,
      actorUserId: o.actorUserId,
      kind: "parent_changed",
      payload: { before: before ? epicRef(before, board.keyPrefix) : null, after: after ? epicRef(after, board.keyPrefix) : null },
    });
    return { productSlug, number: item.number };
  });
}

/** The Watch button: start or stop getting this item's emails. */
export async function setWatching(o: { itemId: string; userId: string; watching: boolean }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    if (o.watching) await addWatchers(tx, item.id, [o.userId]);
    else await tx.delete(workWatchers).where(and(eq(workWatchers.itemId, item.id), eq(workWatchers.userId, o.userId)));
    return { productSlug, number: item.number };
  });
}

// ---------------------------------------------------------------------------
// Links, clone, move, attachments (Jira's Link issue / Clone / Move / Attach)
// ---------------------------------------------------------------------------

const itemLabel = (key: string, title: string) => ({ name: `${key} ${title}` });

/** Insert one link and write the event on both ends; false when that exact link already exists. */
async function linkTx(
  tx: Tx,
  o: { a: { id: string; key: string; title: string }; b: { id: string; key: string; title: string }; type: WorkLinkType; direction: LinkDirection; actorUserId: string | null },
): Promise<boolean> {
  if (o.a.id === o.b.id) throw new Error("An item can't be linked to itself");
  const row = linkRow({ itemId: o.a.id, otherItemId: o.b.id, type: o.type, direction: o.direction });
  if (o.type === "relates") {
    // Symmetric: one row covers both directions, so refuse the mirror too.
    const mirror = await tx.query.workItemLinks.findFirst({
      where: and(eq(workItemLinks.sourceItemId, row.targetItemId), eq(workItemLinks.targetItemId, row.sourceItemId), eq(workItemLinks.type, "relates")),
      columns: { id: true },
    });
    if (mirror) return false;
  }
  const [created] = await tx.insert(workItemLinks).values({ ...row, createdByUserId: o.actorUserId }).onConflictDoNothing().returning({ id: workItemLinks.id });
  if (!created) return false;
  const aDir: LinkDirection = row.sourceItemId === o.a.id ? "outward" : "inward";
  const bDir: LinkDirection = aDir === "outward" ? "inward" : "outward";
  await recordEvent(tx, { itemId: o.a.id, actorUserId: o.actorUserId, kind: "link_added", payload: { phrase: linkPhrase(o.type, aDir), other: itemLabel(o.b.key, o.b.title) } });
  await recordEvent(tx, { itemId: o.b.id, actorUserId: o.actorUserId, kind: "link_added", payload: { phrase: linkPhrase(o.type, bDir), other: itemLabel(o.a.key, o.a.title) } });
  return true;
}

export async function addItemLink(o: {
  itemId: string;
  otherItemId: string;
  type: WorkLinkType;
  direction: LinkDirection;
  actorUserId: string;
}): Promise<{ productSlug: string; number: number; otherSlug: string; otherNumber: number }> {
  return db.transaction(async (tx) => {
    const a = await itemContext(tx, o.itemId);
    const b = await itemContext(tx, o.otherItemId);
    const created = await linkTx(tx, {
      a: { id: a.item.id, key: a.key, title: a.item.title },
      b: { id: b.item.id, key: b.key, title: b.item.title },
      type: o.type,
      direction: o.direction,
      actorUserId: o.actorUserId,
    });
    if (!created) throw new Error(`${a.key} and ${b.key} are already linked that way`);
    return { productSlug: a.productSlug, number: a.item.number, otherSlug: b.productSlug, otherNumber: b.item.number };
  });
}

export async function removeItemLink(o: { linkId: string; actorUserId: string }): Promise<{ items: { slug: string; number: number }[] }> {
  return db.transaction(async (tx) => {
    const link = await tx.query.workItemLinks.findFirst({ where: eq(workItemLinks.id, o.linkId) });
    if (!link) throw new Error("That link no longer exists");
    const s = await itemContext(tx, link.sourceItemId);
    const t = await itemContext(tx, link.targetItemId);
    await tx.delete(workItemLinks).where(eq(workItemLinks.id, link.id));
    await recordEvent(tx, { itemId: s.item.id, actorUserId: o.actorUserId, kind: "link_removed", payload: { phrase: linkPhrase(link.type, "outward"), other: itemLabel(t.key, t.item.title) } });
    await recordEvent(tx, { itemId: t.item.id, actorUserId: o.actorUserId, kind: "link_removed", payload: { phrase: linkPhrase(link.type, "inward"), other: itemLabel(s.key, s.item.title) } });
    return { items: [{ slug: s.productSlug, number: s.item.number }, { slug: t.productSlug, number: t.item.number }] };
  });
}

/**
 * Jira's Clone: a new item on the same board with the same fields (status back
 * to To do, or Backlog for a backlog item; no sprint), linked to the original
 * as "clones". The client (requester) is copied only when ops clone it.
 */
export async function cloneItem(o: {
  itemId: string;
  title: string;
  includeAttachments: boolean;
  includeLinks: boolean;
  actorUserId: string;
  copyRequester: boolean;
}): Promise<{ id: string; number: number; key: string; productSlug: string }> {
  const src = await db.query.workItems.findFirst({ where: eq(workItems.id, o.itemId) });
  if (!src) throw new Error("Item not found");
  const created = await createItem({
    boardId: src.boardId,
    title: o.title.trim() || cloneTitle(src.title),
    description: src.description,
    type: src.type,
    priority: src.priority,
    status: src.status === "backlog" ? "backlog" : "todo",
    estimatePoints: src.estimatePoints,
    assigneeUserId: src.assigneeUserId,
    labels: src.labels,
    dueOn: src.dueOn,
    source: src.source,
    parentId: src.type === "epic" ? null : src.parentId,
    reporterUserId: o.actorUserId,
    requesterTenantId: o.copyRequester ? src.requesterTenantId : null,
  });
  await db.transaction(async (tx) => {
    const a = await itemContext(tx, created.id);
    const b = await itemContext(tx, src.id);
    if (o.includeAttachments) {
      await tx.execute(sql`
        insert into work_attachments (item_id, uploaded_by_user_id, content_type, byte_size, file_name, data)
        select ${created.id}, uploaded_by_user_id, content_type, byte_size, file_name, data
        from work_attachments where item_id = ${src.id}`);
    }
    if (o.includeLinks) {
      const links = await tx.select().from(workItemLinks).where(or(eq(workItemLinks.sourceItemId, src.id), eq(workItemLinks.targetItemId, src.id)));
      for (const l of links) {
        const outward = l.sourceItemId === src.id;
        const other = await itemContext(tx, outward ? l.targetItemId : l.sourceItemId);
        await linkTx(tx, {
          a: { id: a.item.id, key: a.key, title: a.item.title },
          b: { id: other.item.id, key: other.key, title: other.item.title },
          type: l.type,
          direction: outward ? "outward" : "inward",
          actorUserId: o.actorUserId,
        });
      }
    }
    await linkTx(tx, {
      a: { id: a.item.id, key: a.key, title: a.item.title },
      b: { id: b.item.id, key: b.key, title: b.item.title },
      type: "clones",
      direction: "outward",
      actorUserId: o.actorUserId,
    });
  });
  return created;
}

/**
 * Jira's Move: the item goes to another product's board under that board's
 * next key. Sprint and epic are board-local, so both are cleared; an epic with
 * children stays put until they move or leave it. The old key keeps working
 * (work_item_aliases; the item page and quick view redirect).
 */
export async function moveItemToBoard(o: { itemId: string; targetSlug: string; actorUserId: string }): Promise<{ fromSlug: string; slug: string; number: number; key: string }> {
  const target = await ensureBoardForProductSlug(o.targetSlug);
  if (!target) throw new Error("That board doesn't exist");
  return db.transaction(async (tx) => {
    const { item, productSlug, key } = await itemContext(tx, o.itemId, true);
    if (item.boardId === target.board.id) throw new Error(`${key} is already on that board`);
    if (item.type === "epic") {
      const child = await tx.query.workItems.findFirst({ where: eq(workItems.parentId, item.id), columns: { id: true } });
      if (child) throw new Error("Move this epic's child items, or take them out of it, first");
    }
    const [claim] = await tx
      .update(workBoards)
      .set({ nextItemNumber: sql`${workBoards.nextItemNumber} + 1` })
      .where(eq(workBoards.id, target.board.id))
      .returning({ next: workBoards.nextItemNumber });
    const number = claim.next - 1;
    const newKey = formatKey(target.board.keyPrefix, number);
    await tx.insert(workItemAliases).values({ boardId: item.boardId, number: item.number, itemId: item.id }).onConflictDoNothing();
    const rank = await appendRank(tx, target.board.id, item.status);
    await tx.update(workItems).set({ boardId: target.board.id, number, rank, sprintId: null, parentId: null }).where(eq(workItems.id, item.id));
    await recordEvent(tx, {
      itemId: item.id,
      actorUserId: o.actorUserId,
      kind: "item_moved",
      payload: { from: key, to: newKey, fromBoard: productSlug, toBoard: o.targetSlug, clearedSprint: item.sprintId != null, clearedEpic: item.parentId != null },
    });
    return { fromSlug: productSlug, slug: o.targetSlug, number, key: newKey };
  });
}

/** Jira's Attach: a file in the item's Attachments section. */
export async function attachFile(o: { itemId: string; bytes: Uint8Array; fileName: string; actorUserId: string }): Promise<{ id: string; productSlug: string; number: number }> {
  const check = fileAttachmentType(o.fileName, o.bytes);
  if ("problem" in check) throw new Error(check.problem);
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    const fileName = o.fileName.trim().slice(0, 200) || "file";
    const [row] = await tx
      .insert(workAttachments)
      .values({ itemId: item.id, uploadedByUserId: o.actorUserId, contentType: check.type, byteSize: o.bytes.byteLength, fileName, data: Buffer.from(o.bytes) })
      .returning({ id: workAttachments.id });
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "attachment_added", payload: { fileName } });
    return { id: row.id, productSlug, number: item.number };
  });
}

/** The person who attached a file, or an ops admin, may remove it. */
export async function removeAttachment(o: { attachmentId: string; actorUserId: string; actorIsAdmin: boolean }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const att = await tx.query.workAttachments.findFirst({
      where: eq(workAttachments.id, o.attachmentId),
      columns: { id: true, itemId: true, uploadedByUserId: true, fileName: true },
    });
    if (!att?.itemId) throw new Error("That attachment no longer exists");
    if (!o.actorIsAdmin && att.uploadedByUserId !== o.actorUserId) throw new Error("Only the person who attached it or an ops admin can delete it");
    const { item, productSlug } = await itemContext(tx, att.itemId);
    await tx.delete(workAttachments).where(eq(workAttachments.id, att.id));
    await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "attachment_removed", payload: { fileName: att.fileName ?? "file" } });
    return { productSlug, number: item.number };
  });
}

// ---------------------------------------------------------------------------
// Card menu (Jira's ⋯ on a card): move within the column, cover image
// ---------------------------------------------------------------------------

export type ColumnMove = "top" | "up" | "down" | "bottom";

/** Jira's "Move work item": reorder within the item's own column (same board and status). */
export async function rankInColumn(o: { itemId: string; to: ColumnMove; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId, true);
    const col = await tx
      .select({ id: workItems.id, rank: workItems.rank })
      .from(workItems)
      .where(and(eq(workItems.boardId, item.boardId), eq(workItems.status, item.status)))
      .orderBy(asc(workItems.rank), asc(workItems.createdAt));
    const i = col.findIndex((r) => r.id === item.id);
    const others = col.filter((r) => r.id !== item.id);
    const at = (k: number) => others[k]?.rank ?? null;
    // Target slot in `others` (the column without this item): the item goes before others[slot].
    const slot = o.to === "top" ? 0 : o.to === "bottom" ? others.length : o.to === "up" ? Math.max(0, i - 1) : Math.min(others.length, i + 1);
    if (slot === i) return { productSlug, number: item.number }; // already there
    const rank = rankBetween(at(slot - 1), at(slot));
    await tx.update(workItems).set({ rank }).where(eq(workItems.id, item.id));
    return { productSlug, number: item.number };
  });
}

/** Jira's card cover: one of the item's own attached images, or none. */
export async function setItemCover(o: { itemId: string; attachmentId: string | null; actorUserId: string }): Promise<{ productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    if (o.attachmentId) {
      const att = await tx.query.workAttachments.findFirst({ where: eq(workAttachments.id, o.attachmentId), columns: { itemId: true, contentType: true } });
      if (!att || att.itemId !== item.id) throw new Error("Pick one of this item's attached images");
      if (!att.contentType.startsWith("image/")) throw new Error("Only an image can be a cover");
    }
    await tx.update(workItems).set({ coverAttachmentId: o.attachmentId }).where(eq(workItems.id, item.id));
    return { productSlug, number: item.number };
  });
}

/** What the card menu's dialogs need, loaded when one opens: the board's epics, the item's images, the board's labels. */
export async function cardMenuData(itemId: string): Promise<{
  epics: { id: string; key: string; title: string }[];
  images: { id: string; fileName: string }[];
  labels: string[];
  parentId: string | null;
  coverId: string | null;
}> {
  const item = await db.query.workItems.findFirst({ where: eq(workItems.id, itemId), columns: { id: true, boardId: true, type: true, parentId: true, coverAttachmentId: true } });
  if (!item) throw new Error("Item not found");
  const board = await db.query.workBoards.findFirst({ where: eq(workBoards.id, item.boardId), columns: { keyPrefix: true } });
  const [epics, images, labels] = await Promise.all([
    item.type === "epic"
      ? Promise.resolve([])
      : db
          .select({ id: workItems.id, number: workItems.number, title: workItems.title })
          .from(workItems)
          .where(and(eq(workItems.boardId, item.boardId), eq(workItems.type, "epic"), ne(workItems.status, "canceled")))
          .orderBy(asc(workItems.number)),
    db
      .select({ id: workAttachments.id, fileName: workAttachments.fileName, contentType: workAttachments.contentType })
      .from(workAttachments)
      .where(eq(workAttachments.itemId, item.id))
      .orderBy(desc(workAttachments.createdAt)),
    db.execute<{ label: string }>(sql`select distinct jsonb_array_elements_text(labels) as label from work_items where board_id = ${item.boardId} order by 1 limit 200`),
  ]);
  return {
    epics: epics.map((e) => ({ id: e.id, key: formatKey(board?.keyPrefix ?? "", e.number), title: e.title })),
    images: images.filter((a) => a.contentType.startsWith("image/")).map((a) => ({ id: a.id, fileName: a.fileName ?? "image" })),
    labels: labels.rows.map((l) => l.label),
    parentId: item.parentId,
    coverId: item.coverAttachmentId,
  };
}

// ---------------------------------------------------------------------------
// The bell: read state
// ---------------------------------------------------------------------------

/** Mark a person's notifications read: some by id, all for one item (they opened it), or all. Returns how many changed. */
export async function markNotificationsRead(o: { userId: string; ids?: string[]; itemId?: string; all?: boolean }): Promise<number> {
  const scope = o.all ? undefined : o.itemId ? eq(workNotifications.itemId, o.itemId) : o.ids?.length ? inArray(workNotifications.id, o.ids) : null;
  if (scope === null) return 0;
  const rows = await db
    .update(workNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(workNotifications.userId, o.userId), isNull(workNotifications.readAt), scope))
    .returning({ id: workNotifications.id });
  return rows.length;
}

/** Keep the bell small: read notifications go after 30 days, unread after 90. */
export async function pruneNotifications(now = new Date()): Promise<number> {
  const day = 86_400_000;
  const rows = await db
    .delete(workNotifications)
    .where(
      or(
        and(isNotNull(workNotifications.readAt), lt(workNotifications.createdAt, new Date(now.getTime() - 30 * day))),
        lt(workNotifications.createdAt, new Date(now.getTime() - 90 * day)),
      ),
    )
    .returning({ id: workNotifications.id });
  return rows.length;
}
