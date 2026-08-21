ALTER TABLE "onboarding_invites" DROP CONSTRAINT "onboarding_invites_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "onboarding_invites" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_invites" ALTER COLUMN "component_ids" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "onboarding_invites" ALTER COLUMN "component_ids" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_invites" ADD COLUMN "products" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "onboarding_invites" SET "products" = jsonb_build_array(jsonb_build_object(
  'productId', "product_id", 'componentIds', coalesce("component_ids", '[]'::jsonb), 'domainUrl', "domain_url"))
WHERE "product_id" IS NOT NULL;
