CREATE TYPE "public"."partner_app_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "partner_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"product_prefixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_url" text,
	"provision_url" text,
	"webhook_secret_enc" text,
	"allowed_return_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"receives_membership" boolean DEFAULT false NOT NULL,
	"status" "partner_app_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "partner_apps_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "partner_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_app_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_tenant_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_app_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"external_tenant_id" text NOT NULL,
	"linked_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "partner_app_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_keys" ADD COLUMN "partner_app_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_idempotency" ADD CONSTRAINT "partner_idempotency_partner_app_id_partner_apps_id_fk" FOREIGN KEY ("partner_app_id") REFERENCES "public"."partner_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_tenant_links" ADD CONSTRAINT "partner_tenant_links_partner_app_id_partner_apps_id_fk" FOREIGN KEY ("partner_app_id") REFERENCES "public"."partner_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_tenant_links" ADD CONSTRAINT "partner_tenant_links_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_idempotency_app_key_uq" ON "partner_idempotency" USING btree ("partner_app_id","key");--> statement-breakpoint
CREATE INDEX "partner_idempotency_created_idx" ON "partner_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_tenant_links_app_tenant_uq" ON "partner_tenant_links" USING btree ("partner_app_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_tenant_links_app_external_uq" ON "partner_tenant_links" USING btree ("partner_app_id","external_tenant_id");--> statement-breakpoint
CREATE INDEX "partner_tenant_links_tenant_idx" ON "partner_tenant_links" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_partner_app_id_partner_apps_id_fk" FOREIGN KEY ("partner_app_id") REFERENCES "public"."partner_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_keys" ADD CONSTRAINT "partner_keys_partner_app_id_partner_apps_id_fk" FOREIGN KEY ("partner_app_id") REFERENCES "public"."partner_apps"("id") ON DELETE set null ON UPDATE no action;