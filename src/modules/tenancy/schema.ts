import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { member, organization, user } from "../auth/schema";

export const roleRequestStatus = pgEnum("role_request_status", ["pending", "approved", "denied", "canceled"]);

/**
 * A member asking for a different tenant role. Owners/admins decide from
 * the Team page, ops from the client's People tab. One open request per
 * member; removing the member removes the row (the member_removed audit
 * entry is the history).
 */
export const roleRequests = pgTable(
  "role_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** ASSIGNABLE_TENANT_ROLES (src/lib/roles.ts); text so a new role is a one-line CHECK change. */
    requestedRole: text("requested_role").notNull(),
    /** The role held when the request was made; the decision is stale if it changed since. */
    currentRole: text("current_role").notNull(),
    note: text("note"),
    status: roleRequestStatus("status").notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    uniqueIndex("role_requests_open_uidx").on(t.memberId).where(sql`${t.status} = 'pending'`),
    index("role_requests_tenant_status_idx").on(t.tenantId, t.status),
    check("role_requests_requested_role_chk", sql`${t.requestedRole} in ('admin', 'billing', 'member')`),
  ],
);
