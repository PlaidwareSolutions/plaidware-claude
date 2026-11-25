CREATE TYPE "public"."work_resolution" AS ENUM('done', 'fixed', 'wont_do', 'duplicate', 'cannot_reproduce');--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution" "work_resolution";--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "flagged_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "flagged_by_user_id" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "flag_reason" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_flagged_by_user_id_user_id_fk" FOREIGN KEY ("flagged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;