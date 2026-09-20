CREATE TYPE "public"."work_board_mode" AS ENUM('kanban', 'sprints');--> statement-breakpoint
CREATE TYPE "public"."work_item_priority" AS ENUM('urgent', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."work_item_source" AS ENUM('internal', 'client_request', 'incident');--> statement-breakpoint
CREATE TYPE "public"."work_item_status" AS ENUM('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."work_item_type" AS ENUM('feature', 'enhancement', 'bug', 'task');--> statement-breakpoint
CREATE TYPE "public"."work_sprint_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TABLE "work_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"key_prefix" text NOT NULL,
	"mode" "work_board_mode" DEFAULT 'kanban' NOT NULL,
	"sprint_length_days" integer DEFAULT 14 NOT NULL,
	"wip_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_item_number" integer DEFAULT 1 NOT NULL,
	"next_sprint_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_boards_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "work_boards_key_prefix_unique" UNIQUE("key_prefix")
);
--> statement-breakpoint
CREATE TABLE "work_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "work_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"actor_user_id" text,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"type" "work_item_type" DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "work_item_status" DEFAULT 'backlog' NOT NULL,
	"priority" "work_item_priority" DEFAULT 'medium' NOT NULL,
	"rank" text NOT NULL,
	"estimate_points" integer,
	"assignee_user_id" text,
	"reporter_user_id" text,
	"sprint_id" uuid,
	"source" "work_item_source" DEFAULT 'internal' NOT NULL,
	"requester_tenant_id" text,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_on" date,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "work_sprint_status" DEFAULT 'planned' NOT NULL,
	"committed_points" integer,
	"committed_count" integer,
	"completed_points" integer,
	"completed_count" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_boards" ADD CONSTRAINT "work_boards_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comments" ADD CONSTRAINT "work_comments_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_comments" ADD CONSTRAINT "work_comments_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_item_id_work_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_board_id_work_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."work_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_sprint_id_work_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."work_sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_requester_tenant_id_organization_id_fk" FOREIGN KEY ("requester_tenant_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sprints" ADD CONSTRAINT "work_sprints_board_id_work_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."work_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_comments_item_time_idx" ON "work_comments" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "work_item_events_item_time_idx" ON "work_item_events" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_board_number_uidx" ON "work_items" USING btree ("board_id","number");--> statement-breakpoint
CREATE INDEX "work_items_board_status_rank_idx" ON "work_items" USING btree ("board_id","status","rank");--> statement-breakpoint
CREATE INDEX "work_items_assignee_status_idx" ON "work_items" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "work_items_sprint_idx" ON "work_items" USING btree ("sprint_id");--> statement-breakpoint
CREATE INDEX "work_items_requester_idx" ON "work_items" USING btree ("requester_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_sprints_board_number_uidx" ON "work_sprints" USING btree ("board_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "work_sprints_active_uidx" ON "work_sprints" USING btree ("board_id") WHERE "work_sprints"."status" = 'active';--> statement-breakpoint
CREATE INDEX "work_sprints_board_status_idx" ON "work_sprints" USING btree ("board_id","status");