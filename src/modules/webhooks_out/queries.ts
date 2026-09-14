import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { organization } from "../auth/schema";
import { subscriptions } from "../billing/schema";
import { products } from "../catalog/schema";
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
  /** Resolved via the subscription, or payload.hub_org_id for org-level events. */
  tenantId: string | null;
  tenantName: string | null;
  productId: string | null;
  productName: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
};

type Ctx = {
  bySub: Map<string, { tenantId: string; tenantName: string; productId: string; productName: string }>;
  orgName: Map<string, string>;
};

/** Client/product for each delivery — subscription events via the join, org events via payload. */
async function loadContext(rows: (typeof webhookDeliveries.$inferSelect)[]): Promise<Ctx> {
  const subIds = [...new Set(rows.map((r) => r.subscriptionId).filter((x): x is string => !!x))];
  const orgIds = [
    ...new Set(
      rows
        .map((r) => (typeof r.payload.hub_org_id === "string" ? r.payload.hub_org_id : null))
        .filter((x): x is string => !!x),
    ),
  ];
  const [subs, orgs] = await Promise.all([
    subIds.length
      ? db
          .select({
            id: subscriptions.id,
            tenantId: subscriptions.tenantId,
            tenantName: organization.name,
            productId: subscriptions.productId,
            productName: products.name,
          })
          .from(subscriptions)
          .innerJoin(organization, eq(subscriptions.tenantId, organization.id))
          .innerJoin(products, eq(subscriptions.productId, products.id))
          .where(inArray(subscriptions.id, subIds))
      : Promise.resolve([]),
    orgIds.length
      ? db.query.organization.findMany({ where: inArray(organization.id, orgIds), columns: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  return {
    bySub: new Map(subs.map((s) => [s.id, s])),
    orgName: new Map(orgs.map((o) => [o.id, o.name])),
  };
}

function toDto(r: typeof webhookDeliveries.$inferSelect, ctx?: Ctx): WebhookDeliveryDto {
  const sub = r.subscriptionId ? ctx?.bySub.get(r.subscriptionId) : undefined;
  const orgId = typeof r.payload.hub_org_id === "string" ? r.payload.hub_org_id : null;
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
    tenantId: sub?.tenantId ?? orgId,
    tenantName: sub?.tenantName ?? (orgId ? (ctx?.orgName.get(orgId) ?? null) : null),
    productId: sub?.productId ?? null,
    productName: sub?.productName ?? null,
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
  const ctx = await loadContext(rows);
  return rows.map((r) => toDto(r, ctx));
}

export async function listRecentDeliveries(limit = 100): Promise<WebhookDeliveryDto[]> {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  const ctx = await loadContext(rows);
  return rows.map((r) => toDto(r, ctx));
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
    recent: rows.map((r) => toDto(r)),
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
