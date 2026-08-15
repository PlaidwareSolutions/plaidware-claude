import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** 'one_time' | 'recurring' (interval fields carry frequency) |
 *  legacy 'recurring_monthly'/'recurring_yearly' on old rows | 'metered' reserved.
 *  Plain text (not a pg enum) so adding kinds never fights transactional migrations. */

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tagline: text("tagline"),
  description: text("description").notNull(),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  icon: text("icon"),
  color: text("color"),
  /** Free-trial days applied to recurring components at checkout (PRD §4.4). */
  trialDays: integer("trial_days"),
  /** Telemetry freshness SLA in minutes; null = 24h default (PRD §4.8). */
  reporterQuietAfterMinutes: integer("reporter_quiet_after_minutes"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const productComponents = pgTable(
  "product_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** 'base' = the product's single main charge; everything else is 'addon'. */
    role: text("role").notNull().default("addon"),
    /** Billing frequency for kind='recurring': every `intervalCount` `interval`s. */
    interval: text("interval"), // 'week' | 'month' | 'year'
    intervalCount: integer("interval_count").notNull().default(1),
    name: text("name").notNull(),
    description: text("description"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    /** For metered components only (gb | request | user | instance). */
    unit: text("unit"),
    /** Required components are locked into checkout; optional are add-ons. */
    isRequired: boolean("is_required").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    stripeProductId: text("stripe_product_id"),
    stripePriceId: text("stripe_price_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("product_components_product_name_uidx").on(t.productId, t.name),
    // One main charge per product (PRD billing v2).
    uniqueIndex("product_components_base_uidx")
      .on(t.productId)
      .where(sql`${t.role} = 'base'`),
  ],
);
