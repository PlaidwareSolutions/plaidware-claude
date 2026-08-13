CREATE TYPE "public"."promo_duration" AS ENUM('once', 'repeating', 'forever');--> statement-breakpoint
CREATE TYPE "public"."promo_kind" AS ENUM('percent_off', 'amount_off', 'fixed_price', 'free_periods');--> statement-breakpoint
CREATE TYPE "public"."redemption_source" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TYPE "public"."redemption_status" AS ENUM('active', 'completed', 'canceled');--> statement-breakpoint
CREATE TABLE "promo_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"percent_off" integer,
	"amount_cents" integer,
	"free_periods" integer,
	"duration" "promo_duration" DEFAULT 'once' NOT NULL,
	"duration_months" integer,
	"product_id" uuid,
	"component_id" uuid,
	"max_redemptions" integer,
	"times_redeemed" integer DEFAULT 0 NOT NULL,
	"redeem_by" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"stripe_coupon_id" text,
	"stripe_promotion_code_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "promo_codes_value_check" CHECK (("promo_codes"."kind" = 'percent_off' and "promo_codes"."percent_off" between 1 and 100)
       or ("promo_codes"."kind" = 'amount_off' and "promo_codes"."amount_cents" > 0)
       or ("promo_codes"."kind" = 'fixed_price' and "promo_codes"."amount_cents" >= 0)
       or ("promo_codes"."kind" = 'free_periods' and "promo_codes"."free_periods" > 0))
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"subscription_id" uuid,
	"user_id" text,
	"source" "redemption_source" NOT NULL,
	"status" "redemption_status" DEFAULT 'active' NOT NULL,
	"stripe_coupon_id" text,
	"savings_cents" integer DEFAULT 0 NOT NULL,
	"invoices_applied" integer DEFAULT 0 NOT NULL,
	"last_applied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promo_assignments" ADD CONSTRAINT "promo_assignments_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_assignments" ADD CONSTRAINT "promo_assignments_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_component_id_product_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."product_components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_assignments_uidx" ON "promo_assignments" USING btree ("promo_code_id","tenant_id");