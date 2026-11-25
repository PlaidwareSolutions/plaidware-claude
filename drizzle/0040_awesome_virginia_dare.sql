CREATE TABLE "work_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"event_id" uuid,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"excerpt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "work_notifications" ADD CONSTRAINT "work_notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_notifications" ADD CONSTRAINT "work_notifications_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_notifications" ADD CONSTRAINT "work_notifications_event_id_work_item_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."work_item_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_notifications" ADD CONSTRAINT "work_notifications_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_notifications_user_created_idx" ON "work_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "work_notifications_user_unread_idx" ON "work_notifications" USING btree ("user_id") WHERE "work_notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "work_notifications_item_idx" ON "work_notifications" USING btree ("item_id");