CREATE TYPE "public"."role_request_status" AS ENUM('pending', 'approved', 'denied', 'canceled');--> statement-breakpoint
CREATE TABLE "role_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"member_id" text NOT NULL,
	"user_id" text NOT NULL,
	"requested_role" text NOT NULL,
	"current_role" text NOT NULL,
	"note" text,
	"status" "role_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "role_requests_requested_role_chk" CHECK ("role_requests"."requested_role" in ('admin', 'billing', 'member'))
);
--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_requests" ADD CONSTRAINT "role_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_requests_open_uidx" ON "role_requests" USING btree ("member_id") WHERE "role_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "role_requests_tenant_status_idx" ON "role_requests" USING btree ("tenant_id","status");