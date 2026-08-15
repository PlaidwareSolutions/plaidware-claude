CREATE TABLE "tenant_price_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"component_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_price_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_components" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "upcoming_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD COLUMN "interval" text;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD COLUMN "interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_policy" ADD COLUMN "upcoming_reminder_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_components" ADD COLUMN "role" text DEFAULT 'addon' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_components" ADD COLUMN "interval" text;--> statement-breakpoint
ALTER TABLE "product_components" ADD COLUMN "interval_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_price_overrides" ADD CONSTRAINT "tenant_price_overrides_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_price_overrides" ADD CONSTRAINT "tenant_price_overrides_component_id_product_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."product_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_price_overrides_uidx" ON "tenant_price_overrides" USING btree ("tenant_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_components_base_uidx" ON "product_components" USING btree ("product_id") WHERE "product_components"."role" = 'base';--> statement-breakpoint
DROP TYPE "public"."component_kind";--> statement-breakpoint
UPDATE "product_components" SET "kind" = 'recurring', "interval" = 'month' WHERE "kind" = 'recurring_monthly';--> statement-breakpoint
UPDATE "product_components" SET "kind" = 'recurring', "interval" = 'year' WHERE "kind" = 'recurring_yearly';--> statement-breakpoint
UPDATE "subscription_items" SET "interval" = 'month' WHERE "kind" = 'recurring_monthly';--> statement-breakpoint
UPDATE "subscription_items" SET "interval" = 'year' WHERE "kind" = 'recurring_yearly';--> statement-breakpoint
WITH ranked AS (
  SELECT id, product_id, ROW_NUMBER() OVER (
    PARTITION BY product_id
    ORDER BY (CASE WHEN is_required AND kind = 'recurring' THEN 0
                   WHEN is_required AND kind = 'one_time' THEN 1
                   ELSE 2 END), sort_order
  ) AS rn
  FROM "product_components" WHERE is_active = true
)
UPDATE "product_components" pc SET "role" = 'base' FROM ranked r WHERE pc.id = r.id AND r.rn = 1;
