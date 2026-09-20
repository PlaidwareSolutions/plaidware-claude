import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";

/**
 * Who changed what, on every operational surface (PRD §4.12). Rows with a
 * tenant show on that client's Activity tab; rows without one are
 * platform-level (ops role grants) and show on the Access tab.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").references(() => organization.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_platform_idx").on(t.createdAt).where(sql`${t.tenantId} is null`),
    // The per-user timeline (ops user page) unions "did" and "done to them";
    // each arm gets its own index so Postgres can BitmapOr them.
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_logs_target_user_idx").on(sql`(${t.payload}->>'targetUserId')`),
    index("audit_logs_payload_user_idx").on(sql`(${t.payload}->>'userId')`),
  ],
);
