import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { invoices } from "./schema";

export const paymentMethod = pgEnum("payment_method", [
  "stripe_card",
  "stripe_ach",
  "check",
  "zelle",
  "wire",
  "other",
]);

/** First-class payments ledger (PRD §4.5) — the old app never had one. */
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  method: paymentMethod("method").notNull(),
  /** Check number, wire ref, Stripe charge id — whatever identifies it. */
  reference: text("reference"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  /** Null for webhook-recorded Stripe payments. */
  recordedByUserId: text("recorded_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** One dunning case per past-due invoice; resolved when it's paid/voided. */
export const dunningStates = pgTable(
  "dunning_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastReminderAt: timestamp("last_reminder_at"),
    suspendedAt: timestamp("suspended_at"),
    /** Ops override: freeze all automated action on this case. */
    paused: boolean("paused").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("dunning_states_invoice_uidx").on(t.invoiceId)],
);

/** Singleton config (PRD §6 Q2): reminders 3/7/14, suspend at 14 — editable without code. */
export const billingPolicy = pgTable(
  "billing_policy",
  {
    id: integer("id").primaryKey().default(1),
    reminderDays: jsonb("reminder_days").$type<number[]>().notNull().default([3, 7, 14]),
    graceDays: integer("grace_days").notNull().default(14),
    autoSuspend: boolean("auto_suspend").notNull().default(true),
    /** Days before dueDate to send the pre-due reminder (billing v2). */
    upcomingReminderDays: integer("upcoming_reminder_days").notNull().default(3),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check("billing_policy_singleton", sql`${t.id} = 1`)],
);
