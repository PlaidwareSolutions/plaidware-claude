CREATE TABLE "work_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by_user_id" text,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"file_name" text,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_attachments" ADD CONSTRAINT "work_attachments_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_attachments_uploader_idx" ON "work_attachments" USING btree ("uploaded_by_user_id");