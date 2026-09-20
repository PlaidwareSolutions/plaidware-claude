import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";
import { products } from "../catalog/schema";
import {
  WORK_BOARD_MODES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_SOURCES,
  WORK_ITEM_STATUSES,
  WORK_ITEM_TYPES,
  WORK_SPRINT_STATUSES,
  type WorkItemStatus,
} from "./contracts";

/**
 * Development work management: one board per product, items ranked within
 * a status column, optional sprints, comments and a per-item event trail.
 * Platform-level (no tenant): the only client reference is the optional
 * requester on an item, which queries.ts strips for developers.
 */

export const workBoardMode = pgEnum("work_board_mode", WORK_BOARD_MODES);
export const workItemType = pgEnum("work_item_type", WORK_ITEM_TYPES);
export const workItemStatus = pgEnum("work_item_status", WORK_ITEM_STATUSES);
export const workItemPriority = pgEnum("work_item_priority", WORK_ITEM_PRIORITIES);
export const workItemSource = pgEnum("work_item_source", WORK_ITEM_SOURCES);
export const workSprintStatus = pgEnum("work_sprint_status", WORK_SPRINT_STATUSES);

/** One board per product; created lazily on first visit (service.ensureBoard). */
export const workBoards = pgTable("work_boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .unique()
    .references(() => products.id, { onDelete: "cascade" }),
  /** Display-only key prefix ("BLD" → BLD-42). URLs use product slug + number, so it can change freely. */
  keyPrefix: text("key_prefix").notNull().unique(),
  mode: workBoardMode("mode").notNull().default("kanban"),
  sprintLengthDays: integer("sprint_length_days").notNull().default(14),
  /** Soft limits per board column, e.g. { in_progress: 3 }. The UI warns; nothing blocks. */
  wipLimits: jsonb("wip_limits").$type<Partial<Record<WorkItemStatus, number>>>().notNull().default({}),
  /** Monotonic counters, claimed with UPDATE … RETURNING inside the insert transaction. */
  nextItemNumber: integer("next_item_number").notNull().default(1),
  nextSprintNumber: integer("next_sprint_number").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const workSprints = pgTable(
  "work_sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => workBoards.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    goal: text("goal"),
    /** Inclusive calendar days (display zone), YYYY-MM-DD. */
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    status: workSprintStatus("status").notNull().default("planned"),
    /** Snapshots taken at start / completion so later edits don't rewrite history. */
    committedPoints: integer("committed_points"),
    committedCount: integer("committed_count"),
    completedPoints: integer("completed_points"),
    completedCount: integer("completed_count"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("work_sprints_board_number_uidx").on(t.boardId, t.number),
    // One active sprint per board — the database, not the service, arbitrates the race.
    uniqueIndex("work_sprints_active_uidx")
      .on(t.boardId)
      .where(sql`${t.status} = 'active'`),
    index("work_sprints_board_status_idx").on(t.boardId, t.status),
  ],
);

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => workBoards.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    type: workItemType("type").notNull().default("task"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: workItemStatus("status").notNull().default("backlog"),
    priority: workItemPriority("priority").notNull().default("medium"),
    /** Lexicographic order key within (boardId, status); see rank-logic.ts. */
    rank: text("rank").notNull(),
    estimatePoints: integer("estimate_points"),
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    reporterUserId: text("reporter_user_id").references(() => user.id, { onDelete: "set null" }),
    sprintId: uuid("sprint_id").references(() => workSprints.id, { onDelete: "set null" }),
    source: workItemSource("source").notNull().default("internal"),
    /** OPS-ONLY. Never leaves queries.ts for a developer viewer (dto.ts is the single gate). */
    requesterTenantId: text("requester_tenant_id").references(() => organization.id, { onDelete: "set null" }),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    dueOn: date("due_on", { mode: "string" }),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("work_items_board_number_uidx").on(t.boardId, t.number),
    index("work_items_board_status_rank_idx").on(t.boardId, t.status, t.rank),
    index("work_items_assignee_status_idx").on(t.assigneeUserId, t.status),
    index("work_items_sprint_idx").on(t.sprintId),
    index("work_items_requester_idx").on(t.requesterTenantId),
  ],
);

export const workComments = pgTable(
  "work_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    editedAt: timestamp("edited_at"),
  },
  (t) => [index("work_comments_item_time_idx").on(t.itemId, t.createdAt)],
);

/** Per-item history (audit_logs is tenant/platform-scoped and can't hold this). Kinds: event-kinds.ts. */
export const workItemEvents = pgTable(
  "work_item_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("work_item_events_item_time_idx").on(t.itemId, t.createdAt)],
);
