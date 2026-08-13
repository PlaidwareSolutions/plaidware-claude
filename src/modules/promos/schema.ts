import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { subscriptions } from "../billing/schema";

export const promoKind = pgEnum("promo_kind", [
  "percent_off",
  "amount_off",
  "fixed_price",
  "free_periods",
]);

export const promoDuration = pgEnum("promo_duration", [
  "once",
  "repeating",
  "forever",
]);

export const redemptionStatus = pgEnum("redemption_status", [
  "active",
  "completed",
  "canceled",
]);

export const redemptionSource = pgEnum("redemption_source", ["manual", "auto"]);

export const promoCodes = pgTable(
  "promo_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    kind: promoKind("kind").notNull(),
    /** Typed value columns — exactly one is set, enforced by CHECK (PRD §2). */
    percentOff: integer("percent_off"), // 1–100
    amountCents: integer("amount_cents"), // amount_off: discount; fixed_price: target price
    freePeriods: integer("free_periods"),
    duration: promoDuration("duration").notNull().default("once"),
    durationMonths: integer("duration_months"), // when repeating
    /** Scoping: both null = whole order; componentId targets one line item. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    componentId: uuid("component_id").references(() => productComponents.id, {
      onDelete: "set null",
    }),
    maxRedemptions: integer("max_redemptions"),
    timesRedeemed: integer("times_redeemed").notNull().default(0),
    redeemBy: timestamp("redeem_by"),
    isActive: boolean("is_active").notNull().default(true),
    isPublic: boolean("is_public").notNull().default(true),
    autoApply: boolean("auto_apply").notNull().default(false),
    stripeCouponId: text("stripe_coupon_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "promo_codes_value_check",
      sql`(${t.kind} = 'percent_off' and ${t.percentOff} between 1 and 100)
       or (${t.kind} = 'amount_off' and ${t.amountCents} > 0)
       or (${t.kind} = 'fixed_price' and ${t.amountCents} >= 0)
       or (${t.kind} = 'free_periods' and ${t.freePeriods} > 0)`,
    ),
  ],
);

export const promoAssignments = pgTable(
  "promo_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => promoCodes.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // The old app allowed duplicate assignments; this one doesn't.
  (t) => [uniqueIndex("promo_assignments_uidx").on(t.promoCodeId, t.tenantId)],
);

/** Per-redemption savings ledger, reconciled from Stripe invoices (PRD §4.6). */
export const promoRedemptions = pgTable("promo_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  promoCodeId: uuid("promo_code_id")
    .notNull()
    .references(() => promoCodes.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
    onDelete: "set null",
  }),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  /** manual = typed the code; auto = surfaced by auto-apply. */
  source: redemptionSource("source").notNull(),
  status: redemptionStatus("status").notNull().default("active"),
  /** The Stripe coupon actually attached (catalog-level or per-checkout mint). */
  stripeCouponId: text("stripe_coupon_id"),
  savingsCents: integer("savings_cents").notNull().default(0),
  invoicesApplied: integer("invoices_applied").notNull().default(0),
  lastAppliedAt: timestamp("last_applied_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
