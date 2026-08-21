import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";
import type { InviteProductEntry } from "./proposal";

/** One-shot client setup links: ops prepares tenant + pricing + selection,
 *  the client opens one link, sets a password, pays — done. */
export const onboardingInvites = pgTable(
  "onboarding_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** sha256 of the raw token; the raw value only ever lives in the link. */
    tokenHash: text("token_hash").notNull().unique(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Locked per-product configuration — the client can't alter it. */
    products: jsonb("products").$type<InviteProductEntry[]>().notNull().default([]),
    status: text("status").notNull().default("pending"), // pending|accepted|expired|revoked
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("onboarding_invites_token_uidx").on(t.tokenHash),
    index("onboarding_invites_tenant_idx").on(t.tenantId),
  ],
);
