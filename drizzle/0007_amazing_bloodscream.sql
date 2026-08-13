CREATE TYPE "public"."seo_strategy" AS ENUM('mobile', 'desktop');--> statement-breakpoint
CREATE TABLE "seo_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"strategy" "seo_strategy" NOT NULL,
	"performance" integer,
	"seo" integer,
	"accessibility" integer,
	"best_practices" integer,
	"lcp_ms" integer,
	"cls_x1000" integer,
	"inp_ms" integer,
	"ttfb_ms" integer,
	"ok" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_snoozes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"strategy" "seo_strategy" NOT NULL,
	"snoozed_until" timestamp NOT NULL,
	"severity_at_snooze" integer DEFAULT 0 NOT NULL,
	"snoozed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_audits" ADD CONSTRAINT "seo_audits_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_snoozes" ADD CONSTRAINT "seo_snoozes_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_snoozes" ADD CONSTRAINT "seo_snoozes_snoozed_by_user_id_user_id_fk" FOREIGN KEY ("snoozed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_audits_sub_strategy_time_idx" ON "seo_audits" USING btree ("subscription_id","strategy","fetched_at");--> statement-breakpoint
CREATE INDEX "seo_audits_latest_good_idx" ON "seo_audits" USING btree ("subscription_id","strategy","fetched_at") WHERE "seo_audits"."ok" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_snoozes_tenant_strategy_uidx" ON "seo_snoozes" USING btree ("tenant_id","strategy");