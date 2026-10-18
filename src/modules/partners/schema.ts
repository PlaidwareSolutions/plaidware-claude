import {
  boolean,
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
import { organization } from "../auth/schema";
import { subscriptions } from "../billing/schema";

export const partnerAppStatus = pgEnum("partner_app_status", ["active", "disabled"]);

/**
 * An external product app that Hub bills for (e.g. Fixorata). Owns a set of
 * product-slug prefixes; subscriptions to those products emit signed
 * webhooks to its URLs and are readable/mutable through the Partner API
 * (docs/PARTNER-API.md). MHub predates this table and stays env-configured
 * (partners/targets.ts BUILTIN_MHUB).
 */
export const partnerApps = pgTable("partner_apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable machine name, e.g. "fixorata". Shows in audit actors. */
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** Product-slug prefixes this app owns, e.g. ["fixorata"]. */
  productPrefixes: jsonb("product_prefixes").$type<string[]>().notNull().default([]),
  /** Lifecycle webhook target. Null = queue but don't deliver yet. */
  webhookUrl: text("webhook_url"),
  /** Provision handshake target; defaults to webhookUrl when null. */
  provisionUrl: text("provision_url"),
  /** HMAC secret, sealed with lib/crypto (CREDENTIALS_ENCRYPTION_KEY). */
  webhookSecretEnc: text("webhook_secret_enc"),
  /** The partner's own billing page; Hub's billing emails link here for its tenants. */
  billingUrl: text("billing_url"),
  /** Origins Partner API redirect URLs (success/cancel/return) may point at. */
  allowedReturnOrigins: jsonb("allowed_return_origins").$type<string[]>().notNull().default([]),
  /** Whether membership.changed events (and the roster replay) are sent. */
  receivesMembership: boolean("receives_membership").notNull().default(false),
  status: partnerAppStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * API keys for partner endpoints (/api/partners/*). Same shape as
 * ingest_keys — display prefix + SHA-256 hash, soft revoke — scoped by a
 * product-slug-prefix allowlist. Keys with `partnerAppId` also authenticate
 * the Partner API v1 as that app.
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
  partnerAppId: uuid("partner_app_id").references(() => partnerApps.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Hub tenant ↔ the partner app's own tenant id (Fixorata's organizations.id).
 * One-to-one per app in both directions. Written by ops (provisioning tab),
 * by the provision handshake response, and by Partner API tenant creation.
 */
export const partnerTenantLinks = pgTable(
  "partner_tenant_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerAppId: uuid("partner_app_id")
      .notNull()
      .references(() => partnerApps.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    externalTenantId: text("external_tenant_id").notNull(),
    /** "ops:<userId>" | "provision" | "partner_api". */
    linkedBy: text("linked_by").notNull(),
    /**
     * Billing contact the partner keeps current (PATCH /tenants/:ext). When
     * set, Hub's billing emails go here instead of the workspace members —
     * the partner's owner may change without a Hub account changing.
     */
    billingEmail: text("billing_email"),
    billingName: text("billing_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_tenant_links_app_tenant_uq").on(t.partnerAppId, t.tenantId),
    uniqueIndex("partner_tenant_links_app_external_uq").on(t.partnerAppId, t.externalTenantId),
    index("partner_tenant_links_tenant_idx").on(t.tenantId),
  ],
);

/**
 * Replay ledger for Partner API mutations (`Idempotency-Key`). A replay with
 * the same request hash returns the stored response; a different body is a
 * conflict. Rows older than 24h are swept by the partners job.
 */
export const partnerIdempotency = pgTable(
  "partner_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerAppId: uuid("partner_app_id")
      .notNull()
      .references(() => partnerApps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    /** Null while the first request is still in flight. */
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partner_idempotency_app_key_uq").on(t.partnerAppId, t.key),
    index("partner_idempotency_created_idx").on(t.createdAt),
  ],
);

/**
 * No-login payment page links (/pay/<token>) a partner app sends its owner
 * to: Stripe Elements for the subscription's first invoice (or card setup on
 * a trial), then back to the partner's success URL. The raw token is shown
 * once; only its SHA-256 is stored. Expiry matches Stripe's ~23h window for
 * an incomplete subscription's first payment.
 */
export const partnerPayLinks = pgTable(
  "partner_pay_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerAppId: uuid("partner_app_id")
      .notNull()
      .references(() => partnerApps.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    successUrl: text("success_url").notNull(),
    cancelUrl: text("cancel_url"),
    expiresAt: timestamp("expires_at").notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("partner_pay_links_subscription_idx").on(t.subscriptionId)],
);
