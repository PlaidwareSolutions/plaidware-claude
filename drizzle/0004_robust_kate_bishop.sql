CREATE TYPE "public"."payment_method" AS ENUM('stripe_card', 'stripe_ach', 'check', 'zelle', 'wire', 'other');--> statement-breakpoint
CREATE TABLE "billing_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"reminder_days" jsonb DEFAULT '[3,7,14]'::jsonb NOT NULL,
	"grace_days" integer DEFAULT 14 NOT NULL,
	"auto_suspend" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_policy_singleton" CHECK ("billing_policy"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "dunning_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp,
	"suspended_at" timestamp,
	"paused" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"recorded_by_user_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "billing_month" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "monthly_hosting_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "hosting_billing_start_month" text;--> statement-breakpoint
ALTER TABLE "dunning_states" ADD CONSTRAINT "dunning_states_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_states" ADD CONSTRAINT "dunning_states_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dunning_states_invoice_uidx" ON "dunning_states" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_hosting_month_uidx" ON "invoices" USING btree ("subscription_id","billing_month") WHERE "invoices"."kind" = 'hosting';