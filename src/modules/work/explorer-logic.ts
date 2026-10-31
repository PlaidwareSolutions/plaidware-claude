import {
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  type WorkItemPriority,
  type WorkItemStatus,
  type WorkItemType,
} from "./contracts";
import type { WorkCardDto, WorkProductRef } from "./dto";

/**
 * The cross-product "All work" board: its URL state (every filter is a
 * comma list, so a view is a shareable link), swimlane grouping and list
 * sorting. Pure — imported by the page, the toolbar and the tests.
 */

export const EXPLORER_VIEWS = ["board", "list"] as const;
export const EXPLORER_GROUPS = ["none", "epic", "product", "assignee", "priority", "client"] as const;
export const EXPLORER_SORTS = ["rank", "key", "priority", "status", "due", "updated", "created"] as const;
export const EXPLORER_QUICK = ["mine", "recent", "overdue", "flagged", "requests"] as const;
/** The board's columns, Backlog first (a sprints board leaves it to its Backlog tab). */
export const EXPLORER_COLUMNS = ["backlog", "todo", "in_progress", "in_review", "done"] as const;

export type ExplorerView = (typeof EXPLORER_VIEWS)[number];
export type ExplorerGroup = (typeof EXPLORER_GROUPS)[number];
export type ExplorerSort = (typeof EXPLORER_SORTS)[number];
export type ExplorerQuick = (typeof EXPLORER_QUICK)[number];

/** Card on a cross-product board: the product says which board it lives on. */
export type ExplorerCard = WorkCardDto & { product: WorkProductRef };

export type ExplorerFilters = {
  q?: string;
  /** product slugs */
  product: string[];
  /** tenant ids, or "none" (no client) */
  client: string[];
  /** epic ids, or "none" (no epic) */
  epic: string[];
  /** user ids, "me", "unassigned" */
  assignee: string[];
  status: WorkItemStatus[];
  type: WorkItemType[];
  priority: WorkItemPriority[];
  label: string[];
  quick: ExplorerQuick[];
  view: ExplorerView;
  group: ExplorerGroup;
  sort: ExplorerSort;
  dir: "asc" | "desc";
  /** Quick-view panel: "<product slug>~<number>". */
  item?: string;
};

export const DEFAULT_EXPLORER: ExplorerFilters = {
  product: [],
  client: [],
  epic: [],
  assignee: [],
  status: [],
  type: [],
  priority: [],
  label: [],
  quick: [],
  view: "board",
  group: "none",
  sort: "rank",
  dir: "asc",
};

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const token = /^[A-Za-z0-9_-]{1,100}$/;

function list(v: string | string[] | undefined, max = 50): string[] {
  const s = first(v);
  if (!s) return [];
  return [...new Set(s.split(",").map((x) => x.trim()).filter((x) => token.test(x)))].slice(0, max);
}

function oneOf<T extends string>(options: readonly T[], v: string | string[] | undefined, fallback: T): T {
  const s = first(v);
  return s && (options as readonly string[]).includes(s) ? (s as T) : fallback;
}

const enumList = <T extends string>(options: readonly T[], v: string | string[] | undefined): T[] =>
  list(v).filter((x): x is T => (options as readonly string[]).includes(x));

export function parseExplorerFilters(raw: Raw): ExplorerFilters {
  const q = first(raw.q)?.trim().slice(0, 100);
  const item = first(raw.item);
  return {
    q: q || undefined,
    product: list(raw.product),
    client: list(raw.client),
    epic: list(raw.epic),
    assignee: list(raw.assignee),
    status: enumList(WORK_ITEM_STATUSES, raw.status),
    type: enumList(WORK_ITEM_TYPES, raw.type),
    priority: enumList(WORK_ITEM_PRIORITIES, raw.priority),
    label: list(raw.label).map((l) => l.toLowerCase()),
    quick: enumList(EXPLORER_QUICK, raw.quick),
    view: oneOf(EXPLORER_VIEWS, raw.view, "board"),
    group: oneOf(EXPLORER_GROUPS, raw.group, "none"),
    sort: oneOf(EXPLORER_SORTS, raw.sort, "rank"),
    dir: first(raw.dir) === "desc" ? "desc" : "asc",
    item: item && /^[a-z0-9-]{1,80}~\d{1,9}$/.test(item) ? item : undefined,
  };
}

/** Back to search params; defaults are dropped so links stay short. */
export function explorerQuery(f: ExplorerFilters): Record<string, string | undefined> {
  const csv = (xs: readonly string[]) => (xs.length ? xs.join(",") : undefined);
  return {
    q: f.q || undefined,
    product: csv(f.product),
    client: csv(f.client),
    epic: csv(f.epic),
    assignee: csv(f.assignee),
    status: csv(f.status),
    type: csv(f.type),
    priority: csv(f.priority),
    label: csv(f.label),
    quick: csv(f.quick),
    view: f.view === "board" ? undefined : f.view,
    group: f.group === "none" ? undefined : f.group,
    sort: f.sort === "rank" ? undefined : f.sort,
    dir: f.dir === "asc" ? undefined : f.dir,
    item: f.item,
  };
}

/** How many filters narrow the result (view, grouping, sort and the open item don't count). */
export function activeFilterCount(f: ExplorerFilters): number {
  return (
    (f.q ? 1 : 0) +
    f.product.length +
    f.client.length +
    f.epic.length +
    f.assignee.length +
    f.status.length +
    f.type.length +
    f.priority.length +
    f.label.length +
    f.quick.length
  );
}

export const itemRef = (slug: string, number: number) => `${slug}~${number}`;

export function parseItemRef(ref: string | undefined): { slug: string; number: number } | null {
  if (!ref) return null;
  const i = ref.lastIndexOf("~");
  const number = Number(ref.slice(i + 1));
  return i > 0 && Number.isInteger(number) && number > 0 ? { slug: ref.slice(0, i), number } : null;
}

/** Board columns for a filter: the chosen statuses, else all five (four without Backlog on a sprints board). */
export function explorerColumns(f: Pick<ExplorerFilters, "status">, o: { backlog?: boolean } = {}): WorkItemStatus[] {
  const backlog = o.backlog ?? true;
  if (f.status.length) return EXPLORER_COLUMNS.filter((s) => f.status.includes(s));
  return EXPLORER_COLUMNS.filter((s) => s !== "backlog" || backlog);
}

export function isOverdue(card: Pick<WorkCardDto, "dueOn" | "status">, today: string): boolean {
  return !!card.dueOn && card.dueOn < today && card.status !== "done" && card.status !== "canceled";
}

// ---------------------------------------------------------------------------
// Swimlanes
// ---------------------------------------------------------------------------

export type Lane = {
  /** Stable key, e.g. "product:fixorata", "assignee:none". */
  key: string;
  label: string;
  color?: string | null;
  cards: ExplorerCard[];
  /** What a card created in this lane inherits. */
  defaults: { productSlug?: string; assigneeUserId?: string | null; priority?: WorkItemPriority; requesterTenantId?: string | null; parentId?: string | null };
};

const PRIORITY_ORDER: Record<WorkItemPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<WorkItemStatus, number> = { backlog: 0, todo: 1, in_progress: 2, in_review: 3, done: 4, canceled: 5 };

export function groupLanes(cards: ExplorerCard[], group: ExplorerGroup, o: { viewerId?: string; productOrder?: string[] } = {}): Lane[] {
  if (group === "none") return [{ key: "all", label: "All", cards, defaults: {} }];
  const lanes = new Map<string, Lane>();
  const add = (key: string, make: () => Omit<Lane, "cards" | "key">, card: ExplorerCard) => {
    const lane = lanes.get(key) ?? { key, cards: [], ...make() };
    lane.cards.push(card);
    lanes.set(key, lane);
  };
  for (const c of cards) {
    if (group === "epic") {
      // An epic lane creates into the epic's own company.
      if (c.epic) add(`epic:${c.epic.id}`, () => ({ label: `${c.epic!.key} ${c.epic!.title}`, defaults: { parentId: c.epic!.id, productSlug: c.product.slug } }), c);
      else add("epic:none", () => ({ label: "No epic", defaults: { parentId: null } }), c);
    } else if (group === "product") {
      add(`product:${c.product.slug}`, () => ({ label: c.product.name, color: c.product.color, defaults: { productSlug: c.product.slug } }), c);
    } else if (group === "assignee") {
      if (c.assignee) add(`assignee:${c.assignee.id}`, () => ({ label: c.assignee!.name, defaults: { assigneeUserId: c.assignee!.id } }), c);
      else add("assignee:none", () => ({ label: "Unassigned", defaults: { assigneeUserId: null } }), c);
    } else if (group === "priority") {
      add(`priority:${c.priority}`, () => ({ label: c.priority[0].toUpperCase() + c.priority.slice(1), defaults: { priority: c.priority } }), c);
    } else {
      // A developer's card carries no `requester` key for clients they can't see: it lands in "No client".
      if (c.requester) add(`client:${c.requester.tenantId}`, () => ({ label: c.requester!.tenantName, defaults: { requesterTenantId: c.requester!.tenantId } }), c);
      else add("client:none", () => ({ label: "No client", defaults: {} }), c);
    }
  }
  const out = [...lanes.values()];
  const tail = (l: Lane) => (l.key.endsWith(":none") ? 1 : 0);
  if (group === "priority") out.sort((a, b) => PRIORITY_ORDER[a.defaults.priority!] - PRIORITY_ORDER[b.defaults.priority!]);
  else if (group === "product" && o.productOrder) {
    const at = (l: Lane) => o.productOrder!.indexOf(l.defaults.productSlug!);
    out.sort((a, b) => at(a) - at(b));
  } else {
    // You first on the assignee board (Jira's habit), the empty lane last, the rest by name.
    const mine = (l: Lane) => (o.viewerId && l.key === `assignee:${o.viewerId}` ? 0 : 1);
    out.sort((a, b) => mine(a) - mine(b) || tail(a) - tail(b) || a.label.localeCompare(b.label));
  }
  return out;
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

export function sortCards(cards: ExplorerCard[], sort: ExplorerSort, dir: "asc" | "desc", productOrder: string[] = []): ExplorerCard[] {
  const productAt = (c: ExplorerCard) => productOrder.indexOf(c.product.slug);
  const byRank = (a: ExplorerCard, b: ExplorerCard) => productAt(a) - productAt(b) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  const cmp: Record<ExplorerSort, (a: ExplorerCard, b: ExplorerCard) => number> = {
    rank: byRank,
    key: (a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }),
    priority: (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    // No due date sorts after every date, whichever the direction.
    due: (a, b) => (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31"),
    updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    created: (a, b) => a.createdAt.localeCompare(b.createdAt),
  };
  const sign = dir === "desc" ? -1 : 1;
  return [...cards].sort((a, b) => {
    if (sort === "due" && !a.dueOn !== !b.dueOn) return a.dueOn ? -1 : 1;
    return sign * cmp[sort](a, b) || byRank(a, b);
  });
}
