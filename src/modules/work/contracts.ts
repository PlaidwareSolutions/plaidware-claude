import { z } from "zod";

/**
 * Option tuples are the single source for the pg enums (schema.ts), the zod
 * contracts below and every picker in the UI — nothing else lists a status.
 */
export const WORK_BOARD_MODES = ["kanban", "sprints"] as const;
/** "epic" groups other items (their parent); epics stay off the board, like Jira. */
export const WORK_ITEM_TYPES = ["feature", "enhancement", "bug", "task", "epic"] as const;
export const WORK_ITEM_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
export const WORK_ITEM_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const WORK_ITEM_SOURCES = ["internal", "client_request", "incident"] as const;
/** How a Done item was resolved (Jira's Resolution), asked for on the move to Done. */
export const WORK_RESOLUTIONS = ["done", "fixed", "wont_do", "duplicate", "cannot_reproduce"] as const;
export const WORK_SPRINT_STATUSES = ["planned", "active", "completed"] as const;
/** The kanban columns; backlog is a list, canceled items only show on the item page. */
export const BOARD_COLUMNS = ["todo", "in_progress", "in_review", "done"] as const;
export const SPRINT_LENGTHS = [7, 14] as const;
export const CARRY_OVER = ["next", "backlog"] as const;
/** Jira's issue link types, stored from the outward side (A blocks B, A duplicates B, A clones B; relates is symmetric). */
export const WORK_LINK_TYPES = ["blocks", "relates", "duplicates", "clones"] as const;

export type WorkBoardMode = (typeof WORK_BOARD_MODES)[number];
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];
export type WorkItemSource = (typeof WORK_ITEM_SOURCES)[number];
export type WorkResolution = (typeof WORK_RESOLUTIONS)[number];
export type WorkSprintStatus = (typeof WORK_SPRINT_STATUSES)[number];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
export type SprintLength = (typeof SPRINT_LENGTHS)[number];
export type CarryOver = (typeof CARRY_OVER)[number];
export type WorkLinkType = (typeof WORK_LINK_TYPES)[number];

const uuid = z.uuid();
const userId = z.string().min(1);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const title = z.string().trim().min(1).max(200);
/** Editor HTML (or plain text); sanitised and normalised by the service. */
const description = z.string().max(100_000);
const estimate = z.number().int().min(0).max(100);
const label = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Labels are lowercase: letters, digits, dashes");
const labels = z.array(label).max(10);

export const createItemSchema = z.object({
  boardId: uuid,
  title,
  description: description.default(""),
  type: z.enum(WORK_ITEM_TYPES).default("task"),
  priority: z.enum(WORK_ITEM_PRIORITIES).default("medium"),
  /** New items land in the backlog or straight on the board. */
  status: z.enum(["backlog", "todo"]).default("backlog"),
  estimatePoints: estimate.nullable().optional(),
  assigneeUserId: userId.nullable().optional(),
  sprintId: uuid.nullable().optional(),
  labels: labels.default([]),
  dueOn: isoDay.nullable().optional(),
  source: z.enum(WORK_ITEM_SOURCES).default("internal"),
  /** The epic this item belongs to (same board; not for epics). */
  parentId: uuid.nullable().optional(),
});
export type CreateItemInput = z.input<typeof createItemSchema>;
export type CreateItem = z.output<typeof createItemSchema>;

/** Inline create on a board column: product by slug, straight into that column. */
export const quickCreateItemSchema = z.object({
  productSlug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  title,
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done"]),
  type: z.enum(WORK_ITEM_TYPES).default("task"),
  priority: z.enum(WORK_ITEM_PRIORITIES).default("medium"),
  assigneeUserId: userId.nullable().optional(),
  parentId: uuid.nullable().optional(),
});
export type QuickCreateItemInput = z.input<typeof quickCreateItemSchema>;

export const itemPatchSchema = z.object({
  title: title.optional(),
  description: description.optional(),
  type: z.enum(WORK_ITEM_TYPES).optional(),
  priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
  estimatePoints: estimate.nullable().optional(),
  labels: labels.optional(),
  dueOn: isoDay.nullable().optional(),
  source: z.enum(WORK_ITEM_SOURCES).optional(),
});
export type ItemPatch = z.output<typeof itemPatchSchema>;

export const updateItemSchema = z
  .object({ itemId: uuid, patch: itemPatchSchema })
  .refine((v) => Object.values(v.patch).some((x) => x !== undefined), { message: "Nothing to update" });
export type UpdateItemInput = z.input<typeof updateItemSchema>;

/** prevId/nextId: the cards that end up directly before/after the dropped card in the target column. */
export const moveItemSchema = z.object({
  itemId: uuid,
  status: z.enum(WORK_ITEM_STATUSES),
  prevId: uuid.nullable().optional(),
  nextId: uuid.nullable().optional(),
  /** Moving to Done: the resolution (defaults to "done") and an optional comment, from the transition screen. */
  resolution: z.enum(WORK_RESOLUTIONS).optional(),
  comment: z.string().max(50_000).optional(),
});
export type MoveItemInput = z.input<typeof moveItemSchema>;

export const assignItemSchema = z.object({ itemId: uuid, assigneeUserId: userId.nullable() });
export const setItemSprintSchema = z.object({ itemId: uuid, sprintId: uuid.nullable() });
export const setItemRequesterSchema = z.object({ itemId: uuid, requesterTenantId: z.string().min(1).nullable() });
export const setItemParentSchema = z.object({ itemId: uuid, parentId: uuid.nullable() });
export const setWatchingSchema = z.object({ itemId: uuid, watching: z.boolean() });

/** Link this item to another: `direction` says which side this item is on ("outward": this blocks that). */
export const addItemLinkSchema = z.object({
  itemId: uuid,
  otherItemId: uuid,
  type: z.enum(WORK_LINK_TYPES),
  direction: z.enum(["outward", "inward"]).default("outward"),
});
export const cloneItemSchema = z.object({
  itemId: uuid,
  title: z.string().trim().min(1).max(300),
  includeAttachments: z.boolean().default(true),
  includeLinks: z.boolean().default(true),
});
export const moveItemToBoardSchema = z.object({ itemId: uuid, targetSlug: z.string().regex(/^[a-z0-9-]{1,80}$/) });

/** Jira's flag: an impediment marker with an optional reason. */
export const setItemFlagSchema = z.object({ itemId: uuid, flagged: z.boolean(), reason: z.string().trim().max(500).optional() });

const commentBody = z.string().trim().min(1).max(50_000);
/** parentId: replying to a comment (a reply to a reply joins the same thread). */
export const commentSchema = z.object({ itemId: uuid, body: commentBody, parentId: uuid.nullable().optional() });
export const editCommentSchema = z.object({ commentId: uuid, body: commentBody });

const sprintFields = {
  name: z.string().trim().min(1).max(80).optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  startsOn: isoDay.optional(),
  endsOn: isoDay.optional(),
};
const endAfterStart = (v: { startsOn?: string; endsOn?: string }) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn;

export const createSprintSchema = z
  .object({ boardId: uuid, ...sprintFields })
  .refine(endAfterStart, { message: "The sprint must end on or after it starts" });
export type CreateSprintInput = z.input<typeof createSprintSchema>;

export const updateSprintSchema = z
  .object({ sprintId: uuid, ...sprintFields })
  .refine(endAfterStart, { message: "The sprint must end on or after it starts" });
export type UpdateSprintInput = z.input<typeof updateSprintSchema>;

export const completeSprintSchema = z.object({
  sprintId: uuid,
  carryOver: z.enum(CARRY_OVER).default("next"),
});
export type CompleteSprintInput = z.input<typeof completeSprintSchema>;

export const boardSettingsSchema = z.object({
  boardId: uuid,
  keyPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,5}$/, "2–6 letters or digits, starting with a letter"),
  mode: z.enum(WORK_BOARD_MODES),
  sprintLengthDays: z.union([z.literal(7), z.literal(14)]),
  wipLimits: z.partialRecord(z.enum(BOARD_COLUMNS), z.number().int().min(1).max(99)).default({}),
  /** Assignee for tickets filed from partner apps' user reports; null = unassigned. */
  reportAssigneeUserId: userId.nullable().default(null),
});
export type BoardSettingsInput = z.input<typeof boardSettingsSchema>;
export type BoardSettings = z.output<typeof boardSettingsSchema>;

/** URL search params on the board and backlog pages; pages `safeParse` and fall back to {}. */
export const boardFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(WORK_ITEM_TYPES).optional(),
  priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
  /** "me" | "unassigned" | a user id */
  assignee: z.string().min(1).max(100).optional(),
  label: label.optional(),
  /** a sprint id, or "active" (board only) */
  sprint: z.string().min(1).max(100).optional(),
});
export type BoardFilters = z.output<typeof boardFiltersSchema>;

export function parseBoardFilters(raw: Record<string, string | string[] | undefined>): BoardFilters {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) flat[k] = Array.isArray(v) ? v[0] : v;
  const r = boardFiltersSchema.safeParse(flat);
  return r.success ? r.data : {};
}
