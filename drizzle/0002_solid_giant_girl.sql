CREATE TYPE "public"."invoice_kind" AS ENUM('product', 'hosting', 'manual');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'failed', 'void');--> statement-breakpoint
CREATE TYPE "public"."subscription_item_status" AS ENUM('pending', 'active', 'paid', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('incomplete', 'trialing', 'active', 'past_due', 'suspended', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"subscription_id" uuid,
	"kind" "invoice_kind" DEFAULT 'product' NOT NULL,
	"invoice_number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"amount_due_cents" integer NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"description" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stripe_invoice_id" text,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"period_start" timestamp,
	"period_end" timestamp,
	"due_date" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "subscription_item_status" DEFAULT 'active' NOT NULL,
	"stripe_price_id" text,
	"stripe_subscription_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'incomplete' NOT NULL,
	"stripe_subscription_id" text,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"trial_ends_at" timestamp,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_component_id_product_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."product_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscription_items_subscription_idx" ON "subscription_items" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_product_live_uidx" ON "subscriptions" USING btree ("tenant_id","product_id") WHERE "subscriptions"."status" not in ('canceled', 'expired');--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");