import type {
  BoardFilters,
  WorkBoardMode,
  WorkItemPriority,
  WorkItemSource,
  WorkItemStatus,
  WorkItemType,
  WorkResolution,
  WorkSprintStatus,
} from "./contracts";
import { OPS_ONLY_EVENT_KINDS } from "./event-kinds";
import { formatKey } from "./key-logic";
import { sprintDaysLeft, sprintIsOverdue } from "./sprint-logic";

/**
 * Row → DTO mappers for the work area. This file is the single gate that
 * keeps client references away from developers: `toCardDto` only spreads a
 * `requester` the viewer may see (ops: every client; a developer: the
 * workspaces they're a member of), and `visibleEvents` drops events naming
 * any other client. Pure, unit-tested; queries.ts never assembles a card by hand.
 */

export type WorkViewer = {
  userId: string;
  isOps: boolean;
  /** Client workspaces the viewer is a member of (empty for ops, who see all). */
  tenantIds: readonly string[];
};

/** Ops see every client; a developer sees only the workspaces they're on. */
export function canSeeTenant(viewer: WorkViewer, tenantId: string | null | undefined): boolean {
  return viewer.isOps || (!!tenantId && viewer.tenantIds.includes(tenantId));
}
export type WorkUserRef = { id: string; name: string };
/** An epic as other items point at it. */
export type WorkEpicRef = { id: string; key: string; title: string };

export type WorkCardDto = {
  id: string;
  number: number;
  /** "BLD-42" */
  key: string;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  rank: string;
  estimatePoints: number | null;
  assignee: WorkUserRef | null;
  sprintId: string | null;
  source: WorkItemSource;
  labels: string[];
  dueOn: string | null;
  commentCount: number;
  /** Jira's flag: set when the item is impeded (reason optional). */
  flag: { at: string; reason: string | null } | null;
  /** How a Done item was resolved; null while open. */
  resolution: WorkResolution | null;
  /** The epic it belongs to (Jira's parent), same board. */
  epic: WorkEpicRef | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Present for ops viewers (null = no client), and for a developer only when
   * the client is a workspace they're on; otherwise the key is absent (not null).
   */
  requester?: { tenantId: string; tenantName: string } | null;
};

export type CardRow = {
  id: string;
  number: number;
  keyPrefix: string;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  rank: string;
  estimatePoints: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  sprintId: string | null;
  source: WorkItemSource;
  labels: string[];
  dueOn: string | null;
  commentCount: number;
  flaggedAt: Date | null;
  flagReason: string | null;
  resolution: WorkResolution | null;
  epicId: string | null;
  epicNumber: number | null;
  epicTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
  requesterTenantId: string | null;
  requesterTenantName: string | null;
};

export function toCardDto(row: CardRow, viewer: WorkViewer): WorkCardDto {
  const base: WorkCardDto = {
    id: row.id,
    number: row.number,
    key: formatKey(row.keyPrefix, row.number),
    type: row.type,
    title: row.title,
    status: row.status,
    priority: row.priority,
    rank: row.rank,
    estimatePoints: row.estimatePoints,
    assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName ?? "" } : null,
    sprintId: row.sprintId,
    source: row.source,
    labels: row.labels,
    dueOn: row.dueOn,
    commentCount: row.commentCount,
    flag: row.flaggedAt ? { at: row.flaggedAt.toISOString(), reason: row.flagReason } : null,
    resolution: row.resolution,
    epic: row.epicId && row.epicNumber != null ? { id: row.epicId, key: formatKey(row.keyPrefix, row.epicNumber), title: row.epicTitle ?? "" } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (!canSeeTenant(viewer, row.requesterTenantId)) return base;
  return {
    ...base,
    requester: row.requesterTenantId
      ? { tenantId: row.requesterTenantId, tenantName: row.requesterTenantName ?? "Unknown workspace" }
      : null,
  };
}

export type WorkEventDto = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  actor: WorkUserRef | null;
  createdAt: string;
};

export type EventRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  createdAt: Date;
};

export function toEventDto(row: EventRow): WorkEventDto {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    actor: row.actorId ? { id: row.actorId, name: row.actorName ?? "" } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Drops ops-only events unless the viewer may see every client they name
 * (ops see all). An ops-only event naming no client at all stays hidden
 * from developers — nothing to show them.
 */
export function visibleEvents<T extends { kind: string; payload?: unknown }>(rows: T[], viewer: WorkViewer): T[] {
  if (viewer.isOps) return rows;
  return rows.filter((r) => {
    if (!OPS_ONLY_EVENT_KINDS.has(r.kind)) return true;
    const ids = eventTenantIds(r.payload);
    return ids.length > 0 && ids.every((id) => canSeeTenant(viewer, id));
  });
}

/** The client ids a requester_changed payload names (`before`/`after` refs). */
function eventTenantIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const ids: string[] = [];
  for (const k of ["before", "after"] as const) {
    const v = (payload as Record<string, unknown>)[k];
    if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") ids.push((v as { id: string }).id);
  }
  return ids;
}

export type WorkCommentDto = {
  id: string;
  /** Set on a reply: its thread's top-level comment. */
  parentId: string | null;
  body: string;
  author: WorkUserRef | null;
  createdAt: string;
  editedAt: string | null;
  /** The author, or ops, may edit/delete. */
  canEdit: boolean;
};

export type CommentRow = {
  id: string;
  parentId?: string | null;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
  editedAt: Date | null;
};

export function toCommentDto(row: CommentRow, viewer: WorkViewer): WorkCommentDto {
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    body: row.body,
    author: row.authorId ? { id: row.authorId, name: row.authorName ?? "" } : null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    canEdit: viewer.isOps || (row.authorId != null && row.authorId === viewer.userId),
  };
}

export type WorkSprintDto = {
  id: string;
  boardId: string;
  number: number;
  name: string;
  goal: string | null;
  startsOn: string;
  endsOn: string;
  status: WorkSprintStatus;
  committedPoints: number | null;
  committedCount: number | null;
  completedPoints: number | null;
  completedCount: number | null;
  daysLeft: number;
  isOverdue: boolean;
  startedAt: string | null;
  completedAt: string | null;
};

export type SprintRow = {
  id: string;
  boardId: string;
  number: number;
  name: string;
  goal: string | null;
  startsOn: string;
  endsOn: string;
  status: WorkSprintStatus;
  committedPoints: number | null;
  committedCount: number | null;
  completedPoints: number | null;
  completedCount: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export function toSprintDto(row: SprintRow, today: string): WorkSprintDto {
  return {
    id: row.id,
    boardId: row.boardId,
    number: row.number,
    name: row.name,
    goal: row.goal,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status,
    committedPoints: row.committedPoints,
    committedCount: row.committedCount,
    completedPoints: row.completedPoints,
    completedCount: row.completedCount,
    daysLeft: sprintDaysLeft(row, today),
    isOverdue: sprintIsOverdue(row, today),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export type WorkProductRef = { id: string; slug: string; name: string; color: string | null; icon: string | null };

export type WorkBoardDto = {
  id: string;
  product: WorkProductRef;
  keyPrefix: string;
  mode: WorkBoardMode;
  sprintLengthDays: number;
  wipLimits: Partial<Record<WorkItemStatus, number>>;
  activeSprint: WorkSprintDto | null;
  counts: { backlog: number; open: number; plannedSprints: number };
};

export type WorkColumnDto = {
  status: WorkItemStatus;
  label: string;
  wipLimit: number | null;
  cards: WorkCardDto[];
};

export type WorkBoardViewDto = {
  sprint: WorkSprintDto | null;
  columns: WorkColumnDto[];
  /** Sprints board only: items on the board with no sprint. */
  unscheduled: WorkCardDto[];
  filters: BoardFilters;
  assignees: WorkUserRef[];
  labels: string[];
};

/** A product on the cross-product board: filter option, lane, and where "Create" puts an item. */
export type WorkExplorerProduct = WorkProductRef & { boardId: string; keyPrefix: string; mode: WorkBoardMode };

export type WorkExplorerViewDto = {
  /** Every card matching the filters, in product → rank order. */
  cards: (WorkCardDto & { product: WorkProductRef })[];
  products: WorkExplorerProduct[];
  /** Epics of the companies in scope (the Epic filter and lanes). */
  epics: (WorkEpicRef & { productSlug: string })[];
  /** Ops: clients that have items; a developer: their own workspaces. */
  clients: { id: string; name: string }[];
  assignees: WorkUserRef[];
  labels: string[];
  /** Board view only: done older than this many days has dropped off. */
  doneWindowDays: number;
};

export type WorkBacklogViewDto = {
  plannedSprints: { sprint: WorkSprintDto; cards: WorkCardDto[] }[];
  unscheduled: WorkCardDto[];
  backlog: WorkCardDto[];
  filters: BoardFilters;
  assignees: WorkUserRef[];
  labels: string[];
};

export type WorkItemDetailDto = WorkCardDto & {
  description: string;
  reporter: WorkUserRef | null;
  startedAt: string | null;
  completedAt: string | null;
  sprint: Pick<WorkSprintDto, "id" | "number" | "name" | "status"> | null;
  comments: WorkCommentDto[];
  events: WorkEventDto[];
  assignees: WorkUserRef[];
  sprints: Pick<WorkSprintDto, "id" | "number" | "name" | "status">[];
  /** The board's epics (the Parent picker). */
  epics: WorkEpicRef[];
  /** For an epic: its child items, in status order. */
  children: WorkCardDto[];
  /** Who gets this item's emails (Jira's watchers). */
  watchers: WorkUserRef[];
};

export type WorkOverviewRow = {
  product: WorkProductRef;
  board: Pick<WorkBoardDto, "id" | "keyPrefix" | "mode" | "sprintLengthDays"> | null;
  counts: Record<WorkItemStatus, number>;
  myOpen: number;
  activeSprint: (WorkSprintDto & { done: number; total: number }) | null;
};

export type WorkSprintReportDto = {
  sprint: WorkSprintDto;
  done: WorkCardDto[];
  carriedOut: WorkCardDto[];
  remaining: WorkCardDto[];
  /** Mean completed points of the previous completed sprints on this board. */
  velocity: number | null;
  history: { name: string; completedPoints: number | null }[];
};
