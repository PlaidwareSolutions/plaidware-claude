CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_user_idx" ON "audit_logs" USING btree (("payload"->>'targetUserId'));--> statement-breakpoint
CREATE INDEX "audit_logs_payload_user_idx" ON "audit_logs" USING btree (("payload"->>'userId'));