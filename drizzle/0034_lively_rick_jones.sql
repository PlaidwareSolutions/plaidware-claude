CREATE TABLE "work_watchers" (
	"item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_watchers_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_events" ADD COLUMN "notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_watchers" ADD CONSTRAINT "work_watchers_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_watchers" ADD CONSTRAINT "work_watchers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_watchers_user_idx" ON "work_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_item_events_unnotified_idx" ON "work_item_events" USING btree ("created_at") WHERE "work_item_events"."notified_at" is null;--> statement-breakpoint
-- Existing history was never emailed and shouldn't be on deploy: mark it handled.
UPDATE "work_item_events" SET "notified_at" = now() WHERE "notified_at" IS NULL;--> statement-breakpoint
-- Existing items get their natural watchers: reporter, assignee and anyone who commented.
INSERT INTO "work_watchers" ("item_id", "user_id")
SELECT "id", "reporter_user_id" FROM "work_items" WHERE "reporter_user_id" IS NOT NULL
UNION SELECT "id", "assignee_user_id" FROM "work_items" WHERE "assignee_user_id" IS NOT NULL
UNION SELECT "item_id", "author_user_id" FROM "work_comments" WHERE "author_user_id" IS NOT NULL
ON CONFLICT DO NOTHING;
