CREATE TYPE "public"."sender_role" AS ENUM('tenant', 'ops');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"subscription_id" uuid,
	"subject" text NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"last_message_by" "sender_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_user_id" text,
	"sender_role" "sender_role" NOT NULL,
	"body" text NOT NULL,
	"read_by_tenant_at" timestamp,
	"read_by_ops_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_threads_tenant_time_idx" ON "message_threads" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_thread_time_idx" ON "messages" USING btree ("thread_id","created_at");