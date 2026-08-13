import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";
import { subscriptions } from "../billing/schema";

export const senderRole = pgEnum("sender_role", ["tenant", "ops"]);
export const threadStatus = pgEnum("thread_status", ["open", "closed"]);

export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    status: threadStatus("status").notNull().default("open"),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    lastMessageBy: senderRole("last_message_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("message_threads_tenant_time_idx").on(t.tenantId, t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    senderUserId: text("sender_user_id").references(() => user.id, { onDelete: "set null" }),
    senderRole: senderRole("sender_role").notNull(),
    body: text("body").notNull(),
    /** Dual read receipts drive independent unread counters (PRD §4.10). */
    readByTenantAt: timestamp("read_by_tenant_at"),
    readByOpsAt: timestamp("read_by_ops_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_thread_time_idx").on(t.threadId, t.createdAt)],
);
