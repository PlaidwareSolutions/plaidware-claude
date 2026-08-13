CREATE TYPE "public"."cost_source" AS ENUM('railway_api', 'manual');--> statement-breakpoint
CREATE TABLE "app_cost_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hosted_app_id" uuid NOT NULL,
	"month" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"source" "cost_source" NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'railway' NOT NULL,
	"external_ref" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hosted_apps_external_ref_unique" UNIQUE("external_ref")
);
--> statement-breakpoint
CREATE TABLE "product_hosted_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"hosted_app_id" uuid NOT NULL,
	"subscription_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_cost_samples" ADD CONSTRAINT "app_cost_samples_hosted_app_id_hosted_apps_id_fk" FOREIGN KEY ("hosted_app_id") REFERENCES "public"."hosted_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_hosted_apps" ADD CONSTRAINT "product_hosted_apps_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_hosted_apps" ADD CONSTRAINT "product_hosted_apps_hosted_app_id_hosted_apps_id_fk" FOREIGN KEY ("hosted_app_id") REFERENCES "public"."hosted_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_hosted_apps" ADD CONSTRAINT "product_hosted_apps_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_cost_samples_uidx" ON "app_cost_samples" USING btree ("hosted_app_id","month","source");--> statement-breakpoint
CREATE INDEX "app_cost_samples_month_idx" ON "app_cost_samples" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "product_hosted_apps_product_uidx" ON "product_hosted_apps" USING btree ("product_id","hosted_app_id") WHERE "product_hosted_apps"."subscription_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_hosted_apps_sub_uidx" ON "product_hosted_apps" USING btree ("subscription_id") WHERE "product_hosted_apps"."subscription_id" is not null;