import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { isoDay } from "../../lib/dates";
import { roleHasWorkAccess } from "../../lib/roles";
import { organization, user } from "../auth/schema";
import { products } from "../catalog/schema";
import type { BoardSettings, CarryOver, CreateItem, ItemPatch, WorkItemStatus } from "./contracts";
import { defaultKeyPrefix, formatKey, uniqueKeyPrefix } from "./key-logic";
import { RANK_REBALANCE_AT, rankBetween, rebalanceRanks } from "./rank-logic";
import { workBoards, workComments, workItemEvents, workItems, workSprints } from "./schema";
import { addDays, carryOverPatch, isClosedStatus, nextSprintWindow, sprintCommitment, sprintCompletion } from "./sprint-logic";
import { applyTransition, canTransition, sprintForTransition, statusForSprintChange } from "./transitions";

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
  await tx.insert(workItemEvents).values({
    itemId: e.itemId,
    actorUserId: e.actorUserId,
    kind: e.kind,
    payload: e.payload ?? {},
  });
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

export async function updateBoardSettings(o: BoardSettings & { actorUserId: string }): Promise<{ productSlug: string }> {
  return db.transaction(async (tx) => {
    const { board, productSlug, activeSprint } = await boardContext(tx, o.boardId);
    if (o.keyPrefix !== board.keyPrefix) {
      const clash = await tx.query.workBoards.findFirst({ where: eq(workBoards.keyPrefix, o.keyPrefix), columns: { id: true } });
      if (clash) throw new Error(`Key prefix ${o.keyPrefix} is already used by another board`);
    }
    if (o.mode === "kanban" && board.mode === "sprints" && activeSprint) {
      throw new Error("Complete the active sprint before switching this board to kanban");
    }
    await tx
      .update(workBoards)
      .set({ keyPrefix: o.keyPrefix, mode: o.mode, sprintLengthDays: o.sprintLengthDays, wipLimits: o.wipLimits })
      .where(eq(workBoards.id, o.boardId));
    console.log(`[work] board ${board.keyPrefix} settings updated by ${o.actorUserId}`);
    return { productSlug };
  });
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function createItem(
  o: CreateItem & { reporterUserId: string; requesterTenantId?: string | null },
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
        description: o.description,
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
        ...stamps,
      })
      .returning({ id: workItems.id });

    const actor = o.reporterUserId;
    await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "item_created", payload: { title: o.title, type: o.type, priority: o.priority, status } });
    if (assignee) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "assignee_changed", payload: { before: null, after: assignee } });
    if (sprint && sprintId) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "sprint_changed", payload: { before: null, after: sprintRef(sprint), reason: o.sprintId ? "sprint_assigned" : undefined } });
    // The requester is its own (ops-only) event so item_created never names a client.
    if (requester) await recordEvent(tx, { itemId: item.id, actorUserId: actor, kind: "requester_changed", payload: { before: null, after: requester } });

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
    if (p.description !== undefined && p.description !== item.description) {
      set.description = p.description;
      fields.description = { changed: true };
    }
    if (p.type !== undefined && p.type !== item.type) {
      set.type = p.type;
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
}): Promise<{ rank: string; status: WorkItemStatus; sprintId: string | null; productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, board, productSlug, activeSprint } = await itemContext(tx, o.itemId, true);
    const statusChanged = item.status !== o.status;
    if (statusChanged && !canTransition(item.status, o.status)) throw new Error("That move isn't allowed");

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
    await tx.update(workItems).set({ status: o.status, rank, sprintId, ...stamps }).where(eq(workItems.id, item.id));

    if (statusChanged) {
      await recordEvent(tx, { itemId: item.id, actorUserId: o.actorUserId, kind: "status_changed", payload: { before: item.status, after: o.status } });
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

export async function addComment(o: { itemId: string; body: string; authorUserId: string }): Promise<{ commentId: string; productSlug: string; number: number }> {
  return db.transaction(async (tx) => {
    const { item, productSlug } = await itemContext(tx, o.itemId);
    const [c] = await tx.insert(workComments).values({ itemId: item.id, authorUserId: o.authorUserId, body: o.body }).returning({ id: workComments.id });
    await recordEvent(tx, { itemId: item.id, actorUserId: o.authorUserId, kind: "comment_added", payload: { commentId: c.id } });
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
    await tx.update(workComments).set({ body: o.body, editedAt: new Date() }).where(eq(workComments.id, c.id));
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
