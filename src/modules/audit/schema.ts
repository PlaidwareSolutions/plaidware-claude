import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";

/** Who changed what, on every operational surface (PRD §4.12). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_logs_tenant_idx").on(t.tenantId, t.createdAt)],
);
