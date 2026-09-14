ALTER TABLE "subscriptions" ADD COLUMN "suspension_source" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "suspension_note" text;--> statement-breakpoint
ALTER TABLE "tenant_price_overrides" ADD COLUMN "source_invite_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_price_overrides" ADD CONSTRAINT "tenant_price_overrides_source_invite_id_onboarding_invites_id_fk" FOREIGN KEY ("source_invite_id") REFERENCES "public"."onboarding_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_suspension_source_chk" CHECK ("subscriptions"."suspension_source" is null or "subscriptions"."suspension_source" in ('dunning', 'manual'));--> statement-breakpoint
-- Every suspension before this migration came from the dunning sweep.
UPDATE "subscriptions" SET "suspension_source" = 'dunning', "suspended_at" = "updated_at" WHERE "status" = 'suspended' AND "suspension_source" IS NULL;
