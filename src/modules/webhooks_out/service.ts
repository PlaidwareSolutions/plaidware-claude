import { and, asc, eq, inArray, like, lte } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { member, organization, user } from "../auth/schema";
import { subscriptionItems, subscriptions } from "../billing/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { productComponents, products } from "../catalog/schema";
import { getOrCreateProvisioning, setPortalUrl } from "../provisioning/service";
import {
  applyAttemptOutcome,
  buildDeliveryHeaders,
  isMarketingSlug,
  signWebhookPayload,
  type AttemptOutcome,
  type LifecycleEvent,
} from "./logic";
import { webhookDeliveries } from "./schema";

/**
 * Outbound lifecycle webhooks + provisioning handshake for the MHub
 * integration. Emit functions write outbox rows and NEVER throw — a billing
 * transition must not fail because MHub is down. Anything missed (emit-time
 * DB error) is reconciled by MHub through /api/partners/subscriptions.
 */

const DELIVERY_TIMEOUT_MS = 10_000;
const SWEEP_BATCH_SIZE = 50;

export function mhubConfigured(): boolean {
  return Boolean(env.MHUB_WEBHOOK_SECRET && (env.MHUB_LIFECYCLE_URL || env.MHUB_BASE_URL));
}

type SubscriptionRow = typeof subscriptions.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** True when the org holds ≥1 live marketing-* subscription (contract §B scope for org/membership events). */
export async function orgHasLiveMarketingSubscription(orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(
      and(
        eq(subscriptions.tenantId, orgId),
        inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        like(products.slug, "marketing-%"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function buildSubscriptionPayload(
  sub: SubscriptionRow,
  productSlug: string,
): Promise<Record<string, unknown>> {
  const items = await db
    .select({
      name: subscriptionItems.name,
      status: subscriptionItems.status,
      quantity: subscriptionItems.quantity,
      role: productComponents.role,
    })
    .from(subscriptionItems)
    .innerJoin(productComponents, eq(subscriptionItems.componentId, productComponents.id))
    .where(eq(subscriptionItems.subscriptionId, sub.id));

  // The contract's quantity is the sum of item quantities per name (legacy
  // multiples were duplicate rows; they still add up).
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.role === "base" || it.status === "canceled") continue;
    counts.set(it.name, (counts.get(it.name) ?? 0) + it.quantity);
  }

  return {
    hub_subscription_id: sub.id,
    hub_org_id: sub.tenantId,
    product_slug: productSlug,
    status: sub.status,
    current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
    addon_components: [...counts].map(([name, quantity]) => ({ name, quantity })),
  };
}

/**
 * Queue a contract-§B subscription event. No-op unless the product slug is
 * marketing-*. On activation, also kicks off the one-time provisioning
 * handshake (§C). Call from every status-transition site; safe to call
 * unconditionally.
 */
export async function emitSubscriptionLifecycle(
  subscriptionId: string,
  event: LifecycleEvent,
): Promise<void> {
  try {
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });
    if (!sub) return;
    const product = await db.query.products.findFirst({
      where: eq(products.id, sub.productId),
    });
    if (!product || !isMarketingSlug(product.slug)) return;

    await db.insert(webhookDeliveries).values({
      kind: "lifecycle",
      event,
      subscriptionId: sub.id,
      target: env.MHUB_LIFECYCLE_URL ?? "",
      payload: await buildSubscriptionPayload(sub, product.slug),
    });

    if (event === "subscription.activated") {
      await ensureProvisionHandshake(sub, product.slug);
    }
  } catch (e) {
    console.error(`[webhooks_out] emit ${event} sub=${subscriptionId} failed:`, e);
  }
}

/** Queue organization.updated for orgs in marketing scope. Never throws. */
export async function emitOrganizationUpdated(orgId: string): Promise<void> {
  try {
    if (!(await orgHasLiveMarketingSubscription(orgId))) return;
    const org = await db.query.organization.findFirst({ where: eq(organization.id, orgId) });
    if (!org) return;
    await db.insert(webhookDeliveries).values({
      kind: "lifecycle",
      event: "organization.updated",
      target: env.MHUB_LIFECYCLE_URL ?? "",
      payload: { hub_org_id: org.id, name: org.name, slug: org.slug ?? "" },
    });
  } catch (e) {
    console.error(`[webhooks_out] emit organization.updated org=${orgId} failed:`, e);
  }
}

/** Queue membership.changed for orgs in marketing scope. Never throws. */
export async function emitMembershipChanged(opts: {
  orgId: string;
  userId: string;
  role: string;
  action: "added" | "updated" | "removed";
}): Promise<void> {
  try {
    if (!(await orgHasLiveMarketingSubscription(opts.orgId))) return;
    await queueMembershipChanged(opts);
  } catch (e) {
    console.error(`[webhooks_out] emit membership.changed org=${opts.orgId} failed:`, e);
  }
}

async function queueMembershipChanged(opts: {
  orgId: string;
  userId: string;
  role: string;
  action: "added" | "updated" | "removed";
}): Promise<void> {
  const u = await db.query.user.findFirst({ where: eq(user.id, opts.userId) });
  if (!u) return;
  await db.insert(webhookDeliveries).values({
    kind: "lifecycle",
    event: "membership.changed",
    target: env.MHUB_LIFECYCLE_URL ?? "",
    payload: {
      hub_org_id: opts.orgId,
      hub_user_id: opts.userId,
      email: u.email,
      name: u.name,
      role: opts.role,
      action: opts.action,
    },
  });
}

/**
 * First activation of a marketing-* subscription: queue the §C handshake
 * (deduped by an existing provision row for the subscription), create the
 * provisioning row (DNS fields stay null), and replay the current member
 * roster — membership events only start flowing once the org enters
 * marketing scope, so MHub needs the members who joined before.
 */
async function ensureProvisionHandshake(sub: SubscriptionRow, productSlug: string): Promise<void> {
  const existing = await db.query.webhookDeliveries.findFirst({
    where: and(
      eq(webhookDeliveries.subscriptionId, sub.id),
      eq(webhookDeliveries.kind, "provision"),
    ),
  });
  if (existing) return;

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, sub.tenantId),
  });
  if (!org) return;
  const [owner] = await db
    .select({ email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, org.id), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);

  await getOrCreateProvisioning(sub.id);
  await db.insert(webhookDeliveries).values({
    kind: "provision",
    // §C names no event; MHub routes by URL. This value fills the
    // X-Plaidware-Event header and the ops list.
    event: "provision.requested",
    subscriptionId: sub.id,
    target: provisionTarget() ?? "",
    payload: {
      hub_subscription_id: sub.id,
      hub_org_id: org.id,
      product_slug: productSlug,
      org_name: org.name,
      org_slug: org.slug ?? "",
      owner_email: owner?.email ?? "",
      owner_name: owner?.name ?? "",
    },
  });

  const roster = await db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, org.id));
  for (const m of roster) {
    await queueMembershipChanged({
      orgId: org.id,
      userId: m.userId,
      role: m.role,
      action: "added",
    });
  }
}

// ---------------------------------------------------------------------------
// Delivery sweep — runs in the worker (webhooks.deliver-due, every minute)
// ---------------------------------------------------------------------------

function provisionTarget(): string | null {
  return env.MHUB_BASE_URL ? `${env.MHUB_BASE_URL.replace(/\/+$/, "")}/api/hub/provision` : null;
}

function resolveTarget(row: DeliveryRow): string | null {
  return row.kind === "provision" ? provisionTarget() : (env.MHUB_LIFECYCLE_URL ?? null);
}

async function attemptDelivery(row: DeliveryRow): Promise<AttemptOutcome> {
  const target = resolveTarget(row);
  const secret = env.MHUB_WEBHOOK_SECRET;
  if (!target || !secret) {
    return { ok: false, permanent: false, error: "MHUB_* env not configured" };
  }
  // §B bodies wrap in {event, data}; the §C handshake body is flat.
  const rawBody =
    row.kind === "provision"
      ? JSON.stringify(row.payload)
      : JSON.stringify({ event: row.event, data: row.payload });
  const timestampSeconds = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: buildDeliveryHeaders({
        event: row.event,
        deliveryId: row.deliveryId,
        timestampSeconds,
        signature: signWebhookPayload(secret, timestampSeconds, rawBody),
      }),
      body: rawBody,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.status === 410) {
      return { ok: false, permanent: true, error: "410 Gone — disabled by MHub" };
    }
    if (!res.ok) return { ok: false, permanent: false, error: `HTTP ${res.status}` };
    if (row.kind === "provision") {
      // §C response: { tenant_slug, portal_url, events_api_key_prefix }.
      // MHub's provision is idempotent, so a malformed body is retried.
      const parsed: unknown = await res.json().catch(() => null);
      const portalUrl =
        parsed && typeof parsed === "object" && "portal_url" in parsed
          ? (parsed as { portal_url: unknown }).portal_url
          : null;
      if (typeof portalUrl !== "string" || !portalUrl) {
        return { ok: false, permanent: false, error: "2xx but no portal_url in response" };
      }
      if (row.subscriptionId) await setPortalUrl(row.subscriptionId, portalUrl);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, permanent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type SweepResult = {
  attempted: number;
  delivered: number;
  retried: number;
  dead: number;
  disabled: number;
};

/**
 * Attempt every due pending delivery. With MHub env unset this is a pure
 * no-op — rows keep queueing and drain once the env lands (deploys restart
 * the worker), rather than burning their retry budget against nothing.
 */
export async function runDueDeliveries(now = new Date()): Promise<SweepResult | { skipped: true }> {
  if (!mhubConfigured()) return { skipped: true };
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now)))
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(SWEEP_BATCH_SIZE);

  const result: SweepResult = { attempted: 0, delivered: 0, retried: 0, dead: 0, disabled: 0 };
  for (const row of due) {
    result.attempted++;
    const outcome = await attemptDelivery(row);
    const patch = applyAttemptOutcome(row, outcome, new Date());
    await db
      .update(webhookDeliveries)
      .set({ ...patch, target: resolveTarget(row) ?? row.target })
      .where(eq(webhookDeliveries.id, row.id));
    if (patch.status === "delivered") result.delivered++;
    else if (patch.status === "dead") result.dead++;
    else if (patch.status === "disabled") result.disabled++;
    else result.retried++;
  }
  return result;
}

/** Ops requeue for dead/disabled rows: fresh retry budget, same delivery UUID. */
export async function requeueDelivery(deliveryRowId: string): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status: "pending", attemptCount: 0, lastError: null, nextAttemptAt: new Date() })
    .where(eq(webhookDeliveries.id, deliveryRowId));
}
