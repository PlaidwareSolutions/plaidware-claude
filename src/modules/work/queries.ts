import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db";
import { isoDay } from "../../lib/dates";
import { PLATFORM_ROLES, roleHasWorkAccess } from "../../lib/roles";
import { member, organization, user } from "../auth/schema";
import { subscriptions } from "../billing/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { products } from "../catalog/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { BOARD_COLUMNS, WORK_ITEM_STATUSES, type BoardFilters, type WorkItemStatus } from "./contracts";
import {
  toCardDto,
  toCommentDto,
  toEventDto,
  toSprintDto,
  visibleEvents,
  type CardRow,
  type WorkBacklogViewDto,
  type WorkBoardDto,
  type WorkBoardViewDto,
  type WorkCardDto,
  type WorkItemDetailDto,
  type WorkOverviewRow,
  type WorkProductRef,
  type WorkSprintDto,
  type WorkSprintReportDto,
  type WorkUserRef,
  type WorkViewer,
} from "./dto";
import { defaultKeyPrefix } from "./key-logic";
import { workBoards, workComments, workItemEvents, workItems, workSprints } from "./schema";
import { ensureBoardForProductSlug } from "./service";
import { velocity } from "./sprint-logic";
import { OPEN_STATUSES, STATUS_LABELS } from "./transitions";

/**
 * RSC reads for the work area. Every card goes through dto.toCardDto with
 * the viewer, so a developer's payload never carries a client reference
 * except for the workspaces they're a member of (viewer.tenantIds).
 * The ops-side reads at the bottom are only called from requireOpsPage pages.
 */

const assignee = alias(user, "assignee");
const reporter = alias(user, "reporter");
/** Kanban boards keep "done" for this long before it drops off the column. */
const DONE_WINDOW_DAYS = 14;
const WORK_ROLES = PLATFORM_ROLES.filter(roleHasWorkAccess);
const ON_BOARD: readonly WorkItemStatus[] = ["todo", "in_progress", "in_review"];
const OPS_VIEWER: WorkViewer = { userId: "", isOps: true, tenantIds: [] };

const cardColumns = {
  id: workItems.id,
  number: workItems.number,
  keyPrefix: workBoards.keyPrefix,
  type: workItems.type,
  title: workItems.title,
  status: workItems.status,
  priority: workItems.priority,
  rank: workItems.rank,
  estimatePoints: workItems.estimatePoints,
  assigneeId: assignee.id,
  assigneeName: assignee.name,
  sprintId: workItems.sprintId,
  source: workItems.source,
  labels: workItems.labels,
  dueOn: workItems.dueOn,
  commentCount: sql<number>`(select count(*)::int from work_comments c where c.item_id = ${workItems.id})`,
  createdAt: workItems.createdAt,
  updatedAt: workItems.updatedAt,
  requesterTenantId: workItems.requesterTenantId,
  requesterTenantName: organization.name,
};

const productColumns = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  color: products.color,
  icon: products.icon,
};

function cards() {
  return db
    .select(cardColumns)
    .from(workItems)
    .innerJoin(workBoards, eq(workItems.boardId, workBoards.id))
    .leftJoin(assignee, eq(workItems.assigneeUserId, assignee.id))
    .leftJoin(organization, eq(workItems.requesterTenantId, organization.id));
}

function cardsWithProduct() {
  return db
    .select({ ...cardColumns, product: productColumns })
    .from(workItems)
    .innerJoin(workBoards, eq(workItems.boardId, workBoards.id))
    .innerJoin(products, eq(workBoards.productId, products.id))
    .leftJoin(assignee, eq(workItems.assigneeUserId, assignee.id))
    .leftJoin(organization, eq(workItems.requesterTenantId, organization.id));
}

const rankOrder = () => [asc(workItems.rank), asc(workItems.createdAt)];

function filterConds(f: BoardFilters, viewer: WorkViewer) {
  const conds = [];
  if (f.q) {
    const n = Number(f.q);
    const byTitle = ilike(workItems.title, `%${f.q}%`);
    conds.push(Number.isInteger(n) && n > 0 ? or(byTitle, eq(workItems.number, n))! : byTitle);
  }
  if (f.type) conds.push(eq(workItems.type, f.type));
  if (f.priority) conds.push(eq(workItems.priority, f.priority));
  if (f.assignee === "me") conds.push(eq(workItems.assigneeUserId, viewer.userId));
  else if (f.assignee === "unassigned") conds.push(isNull(workItems.assigneeUserId));
  else if (f.assignee) conds.push(eq(workItems.assigneeUserId, f.assignee));
  if (f.label) conds.push(sql`${workItems.labels} @> ${JSON.stringify([f.label])}::jsonb`);
  return conds;
}

const emptyCounts = (): Record<WorkItemStatus, number> =>
  Object.fromEntries(WORK_ITEM_STATUSES.map((s) => [s, 0])) as Record<WorkItemStatus, number>;

/** done / total per sprint. */
async function sprintProgress(sprintIds: string[]): Promise<Map<string, { done: number; total: number }>> {
  if (sprintIds.length === 0) return new Map();
  const rows = await db
    .select({
      sprintId: workItems.sprintId,
      done: sql<number>`count(*) filter (where ${workItems.status} = 'done')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(workItems)
    .where(inArray(workItems.sprintId, sprintIds))
    .groupBy(workItems.sprintId);
  return new Map(rows.filter((r) => r.sprintId).map((r) => [r.sprintId!, { done: r.done, total: r.total }]));
}

async function activeSprintOf(boardId: string) {
  return (
    (await db.query.workSprints.findFirst({ where: and(eq(workSprints.boardId, boardId), eq(workSprints.status, "active")) })) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Overview + navigation
// ---------------------------------------------------------------------------

export async function listBoardsOverview(viewer: WorkViewer, now = new Date()): Promise<WorkOverviewRow[]> {
  const rows = await db
    .select({ product: productColumns, board: workBoards })
    .from(products)
    .leftJoin(workBoards, eq(workBoards.productId, products.id))
    .where(eq(products.isActive, true))
    .orderBy(asc(products.sortOrder), asc(products.name));
  const boardIds = rows.map((r) => r.board?.id).filter((x): x is string => !!x);
  const [counts, mine, active] = boardIds.length
    ? await Promise.all([
        db
          .select({ boardId: workItems.boardId, status: workItems.status, n: count() })
          .from(workItems)
          .where(inArray(workItems.boardId, boardIds))
          .groupBy(workItems.boardId, workItems.status),
        db
          .select({ boardId: workItems.boardId, n: count() })
          .from(workItems)
          .where(and(inArray(workItems.boardId, boardIds), eq(workItems.assigneeUserId, viewer.userId), inArray(workItems.status, OPEN_STATUSES)))
          .groupBy(workItems.boardId),
        db.select().from(workSprints).where(and(inArray(workSprints.boardId, boardIds), eq(workSprints.status, "active"))),
      ])
    : [[], [], []];
  const progress = await sprintProgress(active.map((s) => s.id));
  const today = isoDay(now);
  return rows.map((r) => {
    const c = emptyCounts();
    for (const x of counts) if (x.boardId === r.board?.id) c[x.status] = Number(x.n);
    const sprint = active.find((s) => s.boardId === r.board?.id);
    return {
      product: r.product,
      board: r.board ? { id: r.board.id, keyPrefix: r.board.keyPrefix, mode: r.board.mode, sprintLengthDays: r.board.sprintLengthDays } : null,
      counts: c,
      myOpen: Number(mine.find((m) => m.boardId === r.board?.id)?.n ?? 0),
      activeSprint: sprint ? { ...toSprintDto(sprint, today), ...(progress.get(sprint.id) ?? { done: 0, total: 0 }) } : null,
    };
  });
}

export type WorkBoardNav = { slug: string; name: string; keyPrefix: string; color: string | null };

/** Sidebar list: every active product, with its board's prefix (or the one it would get). */
export async function listBoardsNav(): Promise<WorkBoardNav[]> {
  const rows = await db
    .select({ slug: products.slug, name: products.name, color: products.color, keyPrefix: workBoards.keyPrefix })
    .from(products)
    .leftJoin(workBoards, eq(workBoards.productId, products.id))
    .where(eq(products.isActive, true))
    .orderBy(asc(products.sortOrder), asc(products.name));
  return rows.map((r) => ({ slug: r.slug, name: r.name, color: r.color, keyPrefix: r.keyPrefix ?? defaultKeyPrefix(r.slug) }));
}

export async function countMyOpenItems(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(workItems)
    .where(and(eq(workItems.assigneeUserId, userId), inArray(workItems.status, OPEN_STATUSES)));
  return Number(row?.n ?? 0);
}

export async function getWorkNavCounts(userId: string): Promise<{ my: number }> {
  return { my: await countMyOpenItems(userId) };
}

export async function countOpenItems(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(workItems).where(inArray(workItems.status, OPEN_STATUSES));
  return Number(row?.n ?? 0);
}

export async function listWorkAssignees(): Promise<WorkUserRef[]> {
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.platformRole, WORK_ROLES))
    .orderBy(asc(user.name));
}

export async function listWorkLabels(boardId: string): Promise<string[]> {
  const r = await db.execute<{ l: string }>(
    sql`select distinct l from work_items, jsonb_array_elements_text(labels) as l where board_id = ${boardId} order by l`,
  );
  return r.rows.map((x) => x.l);
}

export type WorkSprintListRow = WorkSprintDto & { done: number; total: number };

export async function listActiveSprints(now = new Date()): Promise<(WorkSprintListRow & { product: WorkProductRef })[]> {
  const rows = await db
    .select({ sprint: workSprints, product: productColumns })
    .from(workSprints)
    .innerJoin(workBoards, eq(workSprints.boardId, workBoards.id))
    .innerJoin(products, eq(workBoards.productId, products.id))
    .where(eq(workSprints.status, "active"))
    .orderBy(asc(workSprints.endsOn));
  const progress = await sprintProgress(rows.map((r) => r.sprint.id));
  const today = isoDay(now);
  return rows.map((r) => ({ ...toSprintDto(r.sprint, today), ...(progress.get(r.sprint.id) ?? { done: 0, total: 0 }), product: r.product }));
}

// ---------------------------------------------------------------------------
// One board
// ---------------------------------------------------------------------------

/** The board for a product slug, created on first visit; null when there is no such product. */
export async function getBoardBySlug(slug: string, now = new Date()): Promise<WorkBoardDto | null> {
  const ensured = await ensureBoardForProductSlug(slug);
  if (!ensured) return null;
  const [product] = await db.select(productColumns).from(products).where(eq(products.id, ensured.productId)).limit(1);
  const board = ensured.board;
  const [active, [counts], [planned]] = await Promise.all([
    activeSprintOf(board.id),
    db
      .select({
        backlog: sql<number>`count(*) filter (where ${workItems.status} = 'backlog')::int`,
        open: sql<number>`count(*) filter (where ${workItems.status} in ('todo', 'in_progress', 'in_review'))::int`,
      })
      .from(workItems)
      .where(eq(workItems.boardId, board.id)),
    db
      .select({ n: count() })
      .from(workSprints)
      .where(and(eq(workSprints.boardId, board.id), eq(workSprints.status, "planned"))),
  ]);
  return {
    id: board.id,
    product,
    keyPrefix: board.keyPrefix,
    mode: board.mode,
    sprintLengthDays: board.sprintLengthDays,
    wipLimits: board.wipLimits,
    activeSprint: active ? toSprintDto(active, isoDay(now)) : null,
    counts: { backlog: counts?.backlog ?? 0, open: counts?.open ?? 0, plannedSprints: Number(planned?.n ?? 0) },
  };
}

/**
 * The kanban columns. Kanban mode shows every on-board item (done only for
 * the last two weeks); sprints mode shows the active (or requested) sprint
 * plus the board's unscheduled items.
 */
export async function getBoardView(
  boardId: string,
  viewer: WorkViewer,
  o: { sprint?: string; filters?: BoardFilters; now?: Date } = {},
): Promise<WorkBoardViewDto | null> {
  const board = await db.query.workBoards.findFirst({ where: eq(workBoards.id, boardId) });
  if (!board) return null;
  const now = o.now ?? new Date();
  const filters = o.filters ?? {};
  const conds = [eq(workItems.boardId, boardId), ...filterConds(filters, viewer)];

  let sprint = null;
  if (board.mode === "sprints") {
    sprint =
      !o.sprint || o.sprint === "active"
        ? await activeSprintOf(boardId)
        : ((await db.query.workSprints.findFirst({ where: and(eq(workSprints.id, o.sprint), eq(workSprints.boardId, boardId)) })) ?? null);
  }

  let rows: CardRow[] = [];
  if (board.mode === "sprints") {
    if (sprint) {
      rows = await cards()
        .where(and(...conds, eq(workItems.sprintId, sprint.id), inArray(workItems.status, BOARD_COLUMNS)))
        .orderBy(...rankOrder());
    }
  } else {
    const since = new Date(now.getTime() - DONE_WINDOW_DAYS * 86_400_000);
    rows = await cards()
      .where(and(...conds, inArray(workItems.status, BOARD_COLUMNS), or(ne(workItems.status, "done"), gte(workItems.completedAt, since))))
      .orderBy(...rankOrder());
  }
  const unscheduled =
    board.mode === "sprints"
      ? await cards()
          .where(and(...conds, isNull(workItems.sprintId), inArray(workItems.status, ON_BOARD)))
          .orderBy(...rankOrder())
      : [];
  const [assignees, labels] = await Promise.all([listWorkAssignees(), listWorkLabels(boardId)]);
  const dtos = rows.map((r) => toCardDto(r, viewer));
  return {
    sprint: sprint ? toSprintDto(sprint, isoDay(now)) : null,
    columns: BOARD_COLUMNS.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      wipLimit: board.wipLimits[status] ?? null,
      cards: dtos.filter((c) => c.status === status),
    })),
    unscheduled: unscheduled.map((r) => toCardDto(r, viewer)),
    filters,
    assignees,
    labels,
  };
}

export async function getBacklogView(boardId: string, viewer: WorkViewer, filters: BoardFilters = {}, now = new Date()): Promise<WorkBacklogViewDto | null> {
  const board = await db.query.workBoards.findFirst({ where: eq(workBoards.id, boardId) });
  if (!board) return null;
  const conds = [eq(workItems.boardId, boardId), ...filterConds(filters, viewer)];
  const planned = await db
    .select()
    .from(workSprints)
    .where(and(eq(workSprints.boardId, boardId), eq(workSprints.status, "planned")))
    .orderBy(asc(workSprints.startsOn), asc(workSprints.number));
  const [backlog, inSprints, unscheduled, assignees, labels] = await Promise.all([
    cards()
      .where(and(...conds, eq(workItems.status, "backlog")))
      .orderBy(...rankOrder()),
    planned.length
      ? cards()
          .where(and(...conds, inArray(workItems.sprintId, planned.map((s) => s.id))))
          .orderBy(...rankOrder())
      : Promise.resolve([] as CardRow[]),
    board.mode === "sprints"
      ? cards()
          .where(and(...conds, isNull(workItems.sprintId), inArray(workItems.status, ON_BOARD)))
          .orderBy(...rankOrder())
      : Promise.resolve([] as CardRow[]),
    listWorkAssignees(),
    listWorkLabels(boardId),
  ]);
  const today = isoDay(now);
  return {
    plannedSprints: planned.map((s) => ({
      sprint: toSprintDto(s, today),
      cards: inSprints.filter((r) => r.sprintId === s.id).map((r) => toCardDto(r, viewer)),
    })),
    unscheduled: unscheduled.map((r) => toCardDto(r, viewer)),
    backlog: backlog.map((r) => toCardDto(r, viewer)),
    filters,
    assignees,
    labels,
  };
}

export async function getItem(boardId: string, number: number, viewer: WorkViewer): Promise<WorkItemDetailDto | null> {
  const [row] = await db
    .select({
      ...cardColumns,
      description: workItems.description,
      reporterId: reporter.id,
      reporterName: reporter.name,
      startedAt: workItems.startedAt,
      completedAt: workItems.completedAt,
      sprintNumber: workSprints.number,
      sprintName: workSprints.name,
      sprintStatus: workSprints.status,
    })
    .from(workItems)
    .innerJoin(workBoards, eq(workItems.boardId, workBoards.id))
    .leftJoin(assignee, eq(workItems.assigneeUserId, assignee.id))
    .leftJoin(organization, eq(workItems.requesterTenantId, organization.id))
    .leftJoin(reporter, eq(workItems.reporterUserId, reporter.id))
    .leftJoin(workSprints, eq(workItems.sprintId, workSprints.id))
    .where(and(eq(workItems.boardId, boardId), eq(workItems.number, number)))
    .limit(1);
  if (!row) return null;
  const [comments, events, assignees, sprints] = await Promise.all([
    db
      .select({ id: workComments.id, body: workComments.body, authorId: user.id, authorName: user.name, createdAt: workComments.createdAt, editedAt: workComments.editedAt })
      .from(workComments)
      .leftJoin(user, eq(workComments.authorUserId, user.id))
      .where(eq(workComments.itemId, row.id))
      .orderBy(asc(workComments.createdAt)),
    db
      .select({ id: workItemEvents.id, kind: workItemEvents.kind, payload: workItemEvents.payload, actorId: user.id, actorName: user.name, createdAt: workItemEvents.createdAt })
      .from(workItemEvents)
      .leftJoin(user, eq(workItemEvents.actorUserId, user.id))
      .where(eq(workItemEvents.itemId, row.id))
      .orderBy(desc(workItemEvents.createdAt))
      .limit(200),
    listWorkAssignees(),
    db
      .select({ id: workSprints.id, number: workSprints.number, name: workSprints.name, status: workSprints.status })
      .from(workSprints)
      .where(and(eq(workSprints.boardId, boardId), inArray(workSprints.status, ["planned", "active"])))
      .orderBy(asc(workSprints.number)),
  ]);
  return {
    ...toCardDto(row, viewer),
    description: row.description,
    reporter: row.reporterId ? { id: row.reporterId, name: row.reporterName ?? "" } : null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    sprint:
      row.sprintId && row.sprintName && row.sprintNumber != null && row.sprintStatus
        ? { id: row.sprintId, number: row.sprintNumber, name: row.sprintName, status: row.sprintStatus }
        : null,
    comments: comments.map((c) => toCommentDto(c, viewer)),
    events: visibleEvents(events, viewer).map(toEventDto),
    assignees,
    sprints,
  };
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export async function listSprints(boardId: string, now = new Date()): Promise<WorkSprintListRow[]> {
  const rows = await db.select().from(workSprints).where(eq(workSprints.boardId, boardId)).orderBy(desc(workSprints.number));
  const progress = await sprintProgress(rows.map((s) => s.id));
  const today = isoDay(now);
  return rows.map((s) => ({ ...toSprintDto(s, today), ...(progress.get(s.id) ?? { done: 0, total: 0 }) }));
}

export async function getSprintReport(sprintId: string, viewer: WorkViewer, now = new Date()): Promise<WorkSprintReportDto | null> {
  const s = await db.query.workSprints.findFirst({ where: eq(workSprints.id, sprintId) });
  if (!s) return null;
  const [items, carriedIds, completed] = await Promise.all([
    cards()
      .where(eq(workItems.sprintId, s.id))
      .orderBy(...rankOrder()),
    db
      .select({ itemId: workItemEvents.itemId })
      .from(workItemEvents)
      .where(
        and(
          eq(workItemEvents.kind, "sprint_changed"),
          sql`${workItemEvents.payload}->>'reason' = 'carry_over'`,
          sql`${workItemEvents.payload}->'before'->>'id' = ${s.id}`,
        ),
      ),
    db
      .select({ number: workSprints.number, name: workSprints.name, completedPoints: workSprints.completedPoints })
      .from(workSprints)
      .where(and(eq(workSprints.boardId, s.boardId), eq(workSprints.status, "completed")))
      .orderBy(asc(workSprints.number)),
  ]);
  const ids = [...new Set(carriedIds.map((r) => r.itemId))];
  const carried = ids.length
    ? await cards()
        .where(inArray(workItems.id, ids))
        .orderBy(...rankOrder())
    : [];
  const dto = (r: CardRow) => toCardDto(r, viewer);
  const previous = completed.filter((c) => c.number < s.number);
  return {
    sprint: toSprintDto(s, isoDay(now)),
    done: items.filter((i) => i.status === "done").map(dto),
    carriedOut: carried.map(dto),
    remaining: items.filter((i) => i.status !== "done" && i.status !== "canceled").map(dto),
    velocity: velocity(previous),
    history: completed.slice(-6).map((c) => ({ name: c.name, completedPoints: c.completedPoints })),
  };
}

// ---------------------------------------------------------------------------
// My work
// ---------------------------------------------------------------------------

export type MyWorkGroup = { product: WorkProductRef; keyPrefix: string; cards: WorkCardDto[] };

export async function listMyWork(viewer: WorkViewer): Promise<MyWorkGroup[]> {
  const rows = await cardsWithProduct()
    .where(and(eq(workItems.assigneeUserId, viewer.userId), inArray(workItems.status, OPEN_STATUSES)))
    .orderBy(asc(products.sortOrder), asc(products.name), ...rankOrder());
  const groups = new Map<string, MyWorkGroup>();
  const order = (s: WorkItemStatus) => ["in_progress", "in_review", "todo", "backlog"].indexOf(s);
  for (const r of rows) {
    const g = groups.get(r.product.id) ?? { product: r.product, keyPrefix: r.keyPrefix, cards: [] };
    g.cards.push(toCardDto(r, viewer));
    groups.set(r.product.id, g);
  }
  for (const g of groups.values()) g.cards.sort((a, b) => order(a.status) - order(b.status) || (a.rank < b.rank ? -1 : 1));
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Ops-side reads (always the ops viewer; only called from ops pages)
// ---------------------------------------------------------------------------

export type TenantWorkItem = WorkCardDto & { product: WorkProductRef };

/** Items a client asked for, newest first. */
export async function listItemsForTenant(tenantId: string): Promise<TenantWorkItem[]> {
  const rows = await cardsWithProduct()
    .where(eq(workItems.requesterTenantId, tenantId))
    .orderBy(desc(workItems.updatedAt));
  return rows.map((r) => ({ ...toCardDto(r, OPS_VIEWER), product: r.product }));
}

export type ProductBoardSummary = {
  slug: string;
  keyPrefix: string;
  mode: WorkBoardDto["mode"];
  open: number;
  inProgress: number;
  activeSprint: WorkSprintListRow | null;
};

export async function boardSummaryForProduct(productId: string, now = new Date()): Promise<ProductBoardSummary | null> {
  const [row] = await db
    .select({ board: workBoards, slug: products.slug })
    .from(workBoards)
    .innerJoin(products, eq(workBoards.productId, products.id))
    .where(eq(workBoards.productId, productId))
    .limit(1);
  if (!row) return null;
  const [[counts], active] = await Promise.all([
    db
      .select({
        open: sql<number>`count(*) filter (where ${workItems.status} in ('todo', 'in_progress', 'in_review'))::int`,
        inProgress: sql<number>`count(*) filter (where ${workItems.status} = 'in_progress')::int`,
      })
      .from(workItems)
      .where(eq(workItems.boardId, row.board.id)),
    activeSprintOf(row.board.id),
  ]);
  const progress = active ? await sprintProgress([active.id]) : new Map();
  return {
    slug: row.slug,
    keyPrefix: row.board.keyPrefix,
    mode: row.board.mode,
    open: counts?.open ?? 0,
    inProgress: counts?.inProgress ?? 0,
    activeSprint: active ? { ...toSprintDto(active, isoDay(now)), ...(progress.get(active.id) ?? { done: 0, total: 0 }) } : null,
  };
}

// ---------------------------------------------------------------------------
// Developer-side client reads: the viewer's own memberships (policy.workViewer
// loads them), never a workspace they're not on. No money, no billing state.
// ---------------------------------------------------------------------------

export type WorkClientRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** The viewer's tenant role on the workspace (context only — developers never reach tenant pages). */
  role: string;
  joinedAt: string;
  products: number;
  openRequests: number;
};

/** The client workspaces the viewer is a member of, with how much they've asked for. */
export async function listClientWorkspaces(viewer: WorkViewer): Promise<WorkClientRow[]> {
  const ids = [...viewer.tenantIds];
  if (ids.length === 0) return [];
  const [orgs, subs, open] = await Promise.all([
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        role: member.role,
        joinedAt: member.createdAt,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(and(eq(member.userId, viewer.userId), inArray(organization.id, ids)))
      .orderBy(asc(organization.name)),
    db
      .select({ tenantId: subscriptions.tenantId, n: count() })
      .from(subscriptions)
      .where(and(inArray(subscriptions.tenantId, ids), inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES)))
      .groupBy(subscriptions.tenantId),
    db
      .select({ tenantId: workItems.requesterTenantId, n: count() })
      .from(workItems)
      .where(and(inArray(workItems.requesterTenantId, ids), inArray(workItems.status, OPEN_STATUSES)))
      .groupBy(workItems.requesterTenantId),
  ]);
  const productCount = new Map(subs.map((s) => [s.tenantId ?? "", Number(s.n)]));
  const openCount = new Map(open.map((o) => [o.tenantId ?? "", Number(o.n)]));
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug ?? "",
    status: o.status ?? "active",
    role: o.role,
    joinedAt: o.joinedAt.toISOString(),
    products: productCount.get(o.id) ?? 0,
    openRequests: openCount.get(o.id) ?? 0,
  }));
}

export type WorkClientBrief = {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  joinedAt: string;
  /** Live subscriptions by product — what the client runs and where; never what it costs. */
  products: { id: string; name: string; slug: string; color: string | null; status: string; domainUrl: string | null }[];
  people: { userId: string; name: string; email: string; role: string; isViewer: boolean }[];
  /** Everything the client asked for, newest first (the requester is visible: it's this workspace). */
  items: TenantWorkItem[];
};

/** One client workspace as a member developer may see it; null unless the viewer is on it. */
export async function getClientWorkspace(tenantId: string, viewer: WorkViewer): Promise<WorkClientBrief | null> {
  if (!viewer.tenantIds.includes(tenantId)) return null;
  const [mine] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, viewer.userId), eq(member.organizationId, tenantId)))
    .limit(1);
  if (!mine) return null;
  const [prods, people, rows] = await Promise.all([
    db
      .select({
        id: subscriptions.id,
        name: products.name,
        slug: products.slug,
        color: products.color,
        status: subscriptions.status,
        domainUrl: subscriptionProvisioning.domainUrl,
      })
      .from(subscriptions)
      .innerJoin(products, eq(subscriptions.productId, products.id))
      .leftJoin(subscriptionProvisioning, eq(subscriptionProvisioning.subscriptionId, subscriptions.id))
      .where(and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES)))
      .orderBy(asc(products.sortOrder), asc(products.name)),
    db
      .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, tenantId))
      .orderBy(asc(member.createdAt)),
    cardsWithProduct().where(eq(workItems.requesterTenantId, tenantId)).orderBy(desc(workItems.updatedAt)),
  ]);
  return {
    id: mine.id,
    name: mine.name,
    slug: mine.slug ?? "",
    status: mine.status ?? "active",
    role: mine.role,
    joinedAt: mine.joinedAt.toISOString(),
    products: prods,
    people: people.map((p) => ({ ...p, isViewer: p.userId === viewer.userId })),
    items: rows.map((r) => ({ ...toCardDto(r, viewer), product: r.product })),
  };
}
