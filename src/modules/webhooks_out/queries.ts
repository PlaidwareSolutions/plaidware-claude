import { desc, inArray, or, sql } from "drizzle-orm";
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

export type TenantDeliveryHealth = {
  recent: WebhookDeliveryDto[];
  total: number;
  dead: number;
  pending: number;
};

/**
 * MHub webhook deliveries for one tenant. Subscription-scoped events join on
 * subscriptionId; org-level events (organization.updated / membership.changed)
 * carry a null subscriptionId and are matched via payload.hub_org_id instead.
 */
export async function tenantDeliveryHealth(
  subIds: string[],
  orgId: string,
  limit = 20,
): Promise<TenantDeliveryHealth> {
  const match = or(
    subIds.length ? inArray(webhookDeliveries.subscriptionId, subIds) : undefined,
    sql`${webhookDeliveries.payload}->>'hub_org_id' = ${orgId}`,
  );
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(match)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  return {
    recent: rows.map(toDto),
    total: rows.length,
    dead: rows.filter((r) => r.status === "dead" || r.status === "disabled").length,
    pending: rows.filter((r) => r.status === "pending").length,
  };
}

/** Sidebar pill: deliveries that need a human (dead letters + 410-disabled). */
export async function countDeadDeliveries(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.status, ["dead", "disabled"]));
  return row?.n ?? 0;
}
