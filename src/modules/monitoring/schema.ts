import {
  boolean,
  doublePrecision,
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
import { subscriptions } from "../billing/schema";

/** Hashed ingest credentials (PRD §4.8) — the old plaintext key is gone. */
export const ingestKeys = pgTable(
  "ingest_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    /** Display prefix, e.g. `pwk_1a2b3c4d…` — never the whole key. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ingest_keys_subscription_idx").on(t.subscriptionId)],
);

/** Per-product KPI contract (PRD §4.8). */
export const productMetricDefinitions = pgTable(
  "product_metric_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    unit: text("unit"),
    valueType: text("value_type").notNull().default("count"),
    aggregation: text("aggregation").notNull().default("sum"), // sum | avg | last | max
    direction: text("direction").notNull().default("up_is_good"),
    target: doublePrecision("target"),
    isPrimary: boolean("is_primary").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [uniqueIndex("product_metric_definitions_uidx").on(t.productId, t.key)],
);

export const healthSource = pgEnum("health_source", ["probe", "reporter"]);

/** Uptime/status time series — 90-day retention (PRD §4.8). */
export const healthChecks = pgTable(
  "health_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    source: healthSource("source").notNull(),
    status: text("status").notNull(), // healthy | degraded | down
    responseTimeMs: integer("response_time_ms"),
    statusCode: integer("status_code"),
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("health_checks_sub_time_idx").on(t.subscriptionId, t.createdAt)],
);

/** Business metric time series — 13-month retention (PRD §4.8). */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    metricKey: text("metric_key").notNull(),
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("usage_records_sub_time_idx").on(t.subscriptionId, t.recordedAt)],
);

/** Ingest call audit — 7-day retention (PRD §4.8). */
export const metricIngestEvents = pgTable(
  "metric_ingest_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    ok: boolean("ok").notNull(),
    statusCode: integer("status_code").notNull(),
    errorMessage: text("error_message"),
    unknownKeys: jsonb("unknown_keys").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("metric_ingest_events_sub_time_idx").on(t.subscriptionId, t.createdAt)],
);

/** Ack pinned to ONE health check — the next failure re-alerts (PRD §4.8). */
export const incidentAcks = pgTable(
  "incident_acks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    healthCheckId: uuid("health_check_id")
      .notNull()
      .references(() => healthChecks.id, { onDelete: "cascade" }),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("incident_acks_check_uidx").on(t.healthCheckId)],
);
