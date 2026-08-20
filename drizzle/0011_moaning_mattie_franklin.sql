CREATE TABLE "onboarding_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"component_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"domain_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "onboarding_invites" ADD CONSTRAINT "onboarding_invites_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_invites" ADD CONSTRAINT "onboarding_invites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_invites" ADD CONSTRAINT "onboarding_invites_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_invites" ADD CONSTRAINT "onboarding_invites_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_invites_token_uidx" ON "onboarding_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "onboarding_invites_tenant_idx" ON "onboarding_invites" USING btree ("tenant_id");