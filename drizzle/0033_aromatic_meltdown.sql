ALTER TYPE "public"."work_item_type" ADD VALUE 'epic';--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_items_parent_idx" ON "work_items" USING btree ("parent_id");