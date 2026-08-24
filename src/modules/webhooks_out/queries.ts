import { desc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { webhookDeliveries } from "./schema";

export type WebhookDeliveryDto = {
  id: string;
  kind: string;
  event: string;
  target: string;
  status: "pending" | "delivered" | "dead" | "disabled";
  attemptCount: number;
  lastError: string | null;
  deliveryId: string;
  subscriptionId: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
};

function toDto(r: typeof webhookDeliveries.$inferSelect): WebhookDeliveryDto {
  return {
    id: r.id,
    kind: r.kind,
    event: r.event,
    target: r.target,
    status: r.status,
    attemptCount: r.attemptCount,
    lastError: r.lastError,
    deliveryId: r.deliveryId,
    subscriptionId: r.subscriptionId,
    nextAttemptAt: r.nextAttemptAt.toISOString(),
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Dead letters + 410-disabled deliveries — the rows needing ops attention. */
export async function listDeadDeliveries(limit = 100): Promise<WebhookDeliveryDto[]> {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.status, ["dead", "disabled"]))
    .orderBy(desc(webhookDeliveries.updatedAt))
    .limit(limit);
  return rows.map(toDto);
}

export async function listRecentDeliveries(limit = 100): Promise<WebhookDeliveryDto[]> {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  return rows.map(toDto);
}
