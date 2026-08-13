import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization, user } from "../auth/schema";
import { subscriptions } from "../billing/schema";

export const seoStrategy = pgEnum("seo_strategy", ["mobile", "desktop"]);

/** One PageSpeed snapshot per fetch; failures still write a row (PRD §4.9). */
export const seoAudits = pgTable(
  "seo_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    strategy: seoStrategy("strategy").notNull(),
    performance: integer("performance"),
    seo: integer("seo"),
    accessibility: integer("accessibility"),
    bestPractices: integer("best_practices"),
    lcpMs: integer("lcp_ms"),
    clsX1000: integer("cls_x1000"),
    inpMs: integer("inp_ms"),
    ttfbMs: integer("ttfb_ms"),
    ok: boolean("ok").notNull().default(false),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    index("seo_audits_sub_strategy_time_idx").on(t.subscriptionId, t.strategy, t.fetchedAt),
    index("seo_audits_latest_good_idx")
      .on(t.subscriptionId, t.strategy, t.fetchedAt)
      .where(sql`${t.ok} = true`),
  ],
);

/** Mute per (tenant, strategy); a sharper regression breaks through (PRD §4.9). */
export const seoSnoozes = pgTable(
  "seo_snoozes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    strategy: seoStrategy("strategy").notNull(),
    snoozedUntil: timestamp("snoozed_until").notNull(),
    severityAtSnooze: integer("severity_at_snooze").notNull().default(0),
    snoozedByUserId: text("snoozed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("seo_snoozes_tenant_strategy_uidx").on(t.tenantId, t.strategy)],
);
