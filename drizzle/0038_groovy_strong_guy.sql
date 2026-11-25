CREATE TYPE "public"."work_link_type" AS ENUM('blocks', 'relates', 'duplicates', 'clones');--> statement-breakpoint
CREATE TABLE "work_item_aliases" (
	"board_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_aliases_board_id_number_pk" PRIMARY KEY("board_id","number")
);
--> statement-breakpoint
CREATE TABLE "work_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_item_id" uuid NOT NULL,
	"target_item_id" uuid NOT NULL,
	"type" "work_link_type" NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_attachments" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item_aliases" ADD CONSTRAINT "work_item_aliases_board_id_work_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."work_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_aliases" ADD CONSTRAINT "work_item_aliases_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_source_item_id_work_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_target_item_id_work_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_aliases_item_idx" ON "work_item_aliases" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_links_uidx" ON "work_item_links" USING btree ("source_item_id","target_item_id","type");--> statement-breakpoint
CREATE INDEX "work_item_links_target_idx" ON "work_item_links" USING btree ("target_item_id");--> statement-breakpoint
ALTER TABLE "work_attachments" ADD CONSTRAINT "work_attachments_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_attachments_item_idx" ON "work_attachments" USING btree ("item_id");