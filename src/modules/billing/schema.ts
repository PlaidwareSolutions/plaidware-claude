import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";

export const subscriptionStatus = pgEnum("subscription_status", [
  "incomplete", // checkout started, first payment not settled
  "trialing",
  "active",
  "past_due",
  "suspended", // dunning outcome (M5)
  "canceled",
  "expired",
]);

export const subscriptionItemStatus = pgEnum("subscription_item_status", [
  "pending", // one-time, awaiting first invoice payment
  "active",
  "paid", // one-time, settled
  "canceled",
]);

export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "open",
  "paid",
  "failed",
  "void",
]);

export const invoiceKind = pgEnum("invoice_kind", [
  "product",
  "hosting", // M5
  "manual", // M5
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    status: subscriptionStatus("status").notNull().default("incomplete"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    trialEndsAt: timestamp("trial_ends_at"),
    /** Monthly hosting fee (PRD §4.5): null = not configured. */
    monthlyHostingCents: integer("monthly_hosting_cents"),
    /** First month to bill hosting for, as YYYY-MM. */
    hostingBillingStartMonth: text("hosting_billing_start_month"),
    subscribedAt: timestamp("subscribed_at").notNull().defaultNow(),
    canceledAt: timestamp("canceled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // PRD §4.4 invariant: one LIVE subscription per tenant per product.
    // Live = anything not terminally closed, so racing checkouts collide here.
    uniqueIndex("subscriptions_tenant_product_live_uidx")
      .on(t.tenantId, t.productId)
      .where(sql`${t.status} not in ('canceled', 'expired')`),
    index("subscriptions_tenant_idx").on(t.tenantId),
  ],
);

export const subscriptionItems = pgTable(
  "subscription_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => productComponents.id),
    /** Snapshot at purchase — later catalog edits never rewrite history. */
    kind: text("kind").notNull(),
    interval: text("interval"), // snapshot: 'week' | 'month' | 'year'
    intervalCount: integer("interval_count").notNull().default(1),
    name: text("name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: subscriptionItemStatus("status").notNull().default("active"),
    stripePriceId: text("stripe_price_id"),
    stripeSubscriptionItemId: text("stripe_subscription_item_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("subscription_items_subscription_idx").on(t.subscriptionId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    kind: invoiceKind("kind").notNull().default("product"),
    invoiceNumber: text("invoice_number").notNull().unique(),
    status: invoiceStatus("status").notNull().default("open"),
    amountDueCents: integer("amount_due_cents").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    currency: text("currency").notNull().default("usd"),
    description: text("description"),
    lineItems: jsonb("line_items")
      .$type<{ name: string; amountCents: number }[]>()
      .notNull()
      .default([]),
    stripeInvoiceId: text("stripe_invoice_id").unique(),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    periodStart: timestamp("period_start"),
    periodEnd: timestamp("period_end"),
    dueDate: timestamp("due_date"),
    paidAt: timestamp("paid_at"),
    /** Pre-due reminder dedupe (billing v2). */
    upcomingReminderSentAt: timestamp("upcoming_reminder_sent_at"),
    /** YYYY-MM for hosting invoices — idempotency key with the partial unique. */
    billingMonth: text("billing_month"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("invoices_tenant_idx").on(t.tenantId),
    uniqueIndex("invoices_hosting_month_uidx")
      .on(t.subscriptionId, t.billingMonth)
      .where(sql`${t.kind} = 'hosting'`),
  ],
);

/** Ops-negotiated per-tenant prices; apply to future checkouts and add-ons.
 *  Existing subscriptions keep their snapshots (billing v2). */
export const tenantPriceOverrides = pgTable(
  "tenant_price_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => productComponents.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    /** Lazily minted tenant-specific Stripe Price. */
    stripePriceId: text("stripe_price_id"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("tenant_price_overrides_uidx").on(t.tenantId, t.componentId)],
);

/** Webhook idempotency ledger (PRD §4.5) — insert-or-skip on Stripe event id. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // Stripe event id (evt_…)
  type: text("type").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});
