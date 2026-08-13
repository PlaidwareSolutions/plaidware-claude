import { sql } from "drizzle-orm";
import {
  index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { products } from "../catalog/schema";
import { subscriptions } from "../billing/schema";

/** Generic hosted-app registry — replaces all replit_* machinery (PRD §4.11). */
export const hostedApps = pgTable("hosted_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("railway"),
  /** Railway service id (or provider-specific ref). */
  externalRef: text("external_ref").notNull().unique(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const productHostedApps = pgTable(
  "product_hosted_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    hostedAppId: uuid("hosted_app_id").notNull().references(() => hostedApps.id, { onDelete: "cascade" }),
    /** Null = product-scoped (cost rollups); set = drives that tenant's view. */
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("product_hosted_apps_product_uidx")
      .on(t.productId, t.hostedAppId)
      .where(sql`${t.subscriptionId} is null`),
    uniqueIndex("product_hosted_apps_sub_uidx")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
  ],
);

export const costSource = pgEnum("cost_source", ["railway_api", "manual"]);

export const appCostSamples = pgTable(
  "app_cost_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostedAppId: uuid("hosted_app_id").notNull().references(() => hostedApps.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // YYYY-MM
    costCents: integer("cost_cents").notNull(),
    source: costSource("source").notNull(),
    breakdown: jsonb("breakdown").$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("app_cost_samples_uidx").on(t.hostedAppId, t.month, t.source),
    index("app_cost_samples_month_idx").on(t.month),
  ],
);
