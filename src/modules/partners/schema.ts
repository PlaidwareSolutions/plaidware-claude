import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * API keys for the read-only partner endpoint (/api/partners/subscriptions).
 * Same shape as ingest_keys — display prefix + SHA-256 hash, soft revoke —
 * but platform-scoped by a product-slug-prefix allowlist instead of a
 * subscription.
 */
export const partnerKeys = pgTable("partner_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Human label, e.g. "mhub-staging". */
  name: text("name").notNull(),
  /** Display prefix, e.g. `ppk_1a2b3c4d` — never the whole key. */
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  /** Product-slug prefixes this key may read, e.g. ["marketing-"]. */
  productPrefixes: jsonb("product_prefixes").$type<string[]>().notNull().default([]),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
