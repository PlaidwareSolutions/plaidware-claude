CREATE TABLE "partner_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_app_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"work_item_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_work_items" ADD CONSTRAINT "partner_work_items_partner_app_id_partner_apps_id_fk" FOREIGN KEY ("partner_app_id") REFERENCES "public"."partner_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_work_items" ADD CONSTRAINT "partner_work_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_work_items_app_ref_uq" ON "partner_work_items" USING btree ("partner_app_id","external_ref");--> statement-breakpoint
CREATE INDEX "partner_work_items_item_idx" ON "partner_work_items" USING btree ("work_item_id");