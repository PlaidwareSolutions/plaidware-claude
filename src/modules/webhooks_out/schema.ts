import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { subscriptions } from "../billing/schema";

export const webhookDeliveryStatus = pgEnum("webhook_delivery_status", [
  "pending", // queued or awaiting retry (see nextAttemptAt)
  "delivered", // target answered 2xx
  "dead", // retries exhausted — surfaced on /ops/webhooks, requeueable
  "disabled", // target answered 410 Gone — permanently off unless requeued
]);

/**
 * Outbox for Hub → MHub calls (integration contract §B/§C). Rows are written
 * synchronously at the emitting transition and drained by the worker's
 * per-minute sweep, so the web process never blocks on MHub being reachable.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 'lifecycle' = fire-and-forget event (§B); 'provision' = handshake whose response is persisted (§C). */
    kind: text("kind").notNull().default("lifecycle"),
    event: text("event").notNull(),
    /** Target URL as of the last attempt; "" until the env was configured. */
    target: text("target").notNull().default(""),
    /** X-Plaidware-Delivery — stable across every retry of this delivery. */
    deliveryId: uuid("delivery_id").notNull().defaultRandom(),
    /** Set for subscription-scoped events; also dedupes the provision handshake. */
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "cascade",
    }),
    /** The `data` object (§B) or the flat provision body (§C). */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_subscription_idx").on(t.subscriptionId),
  ],
);
