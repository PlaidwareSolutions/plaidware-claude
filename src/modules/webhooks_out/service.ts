import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../env";
import { member, organization, user } from "../auth/schema";
import { subscriptionItems, subscriptions } from "../billing/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { productComponents, products } from "../catalog/schema";
import { billingStatusFor } from "../partners/logic";
import { externalTenantIdFor, linkPartnerTenant, partnerPlanKey } from "../partners/service";
import {
  listPartnerTargets,
  partnerForSlug,
  targetConfigured,
  targetForDelivery,
  type PartnerTarget,
} from "../partners/targets";
import { getOrCreateProvisioning, setPortalUrl } from "../provisioning/service";
import {
  applyAttemptOutcome,
  buildDeliveryHeaders,
  signWebhookPayload,
  type AttemptOutcome,
  type LifecycleEvent,
} from "./logic";
import { webhookDeliveries } from "./schema";

/**
 * Outbound lifecycle webhooks + provisioning handshake for partner apps
 * (MHub via env, others via partner_apps — partners/targets.ts). Emit
 * functions write outbox rows and NEVER throw — a billing transition must
 * not fail because a partner is down. Anything missed (emit-time DB error)
 * is reconciled by the partner through /api/partners/*.
 */

const DELIVERY_TIMEOUT_MS = 10_000;
const SWEEP_BATCH_SIZE = 50;

export function mhubConfigured(): boolean {
  return Boolean(env.MHUB_WEBHOOK_SECRET && (env.MHUB_LIFECYCLE_URL || env.MHUB_BASE_URL));
}

type SubscriptionRow = typeof subscriptions.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/**
 * Partners whose products the org holds a live subscription to — the scope
 * for org/membership events (contract §B).
 */
export async function orgPartnerTargets(orgId: string): Promise<PartnerTarget[]> {
  const rows = await db
    .select({ slug: products.slug })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(
      and(
        eq(subscriptions.tenantId, orgId),
        inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
      ),
    );
  if (rows.length === 0) return [];
  const targets = await listPartnerTargets();
  return targets.filter((t) => rows.some((r) => t.prefixes.some((p) => r.slug.startsWith(p))));
}

async function buildSubscriptionPayload(
  sub: SubscriptionRow,
  productSlug: string,
  target: PartnerTarget,
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

  const payload: Record<string, unknown> = {
    hub_subscription_id: sub.id,
    hub_org_id: sub.tenantId,
    product_slug: productSlug,
    status: sub.status,
    current_period_end: sub.currentPeriodEnd?.toISOString() ?? null,
    addon_components: [...counts].map(([name, quantity]) => ({ name, quantity })),
  };
  // MHub's payload is frozen by its contract; partner apps also get their
  // own tenant id and the derived access state (docs/PARTNER-API.md).
  if (target.extendedPayloads && target.appId) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, sub.tenantId),
      columns: { status: true },
    });
    payload.external_tenant_id = await externalTenantIdFor(target.appId, sub.tenantId);
    payload.billing_status = billingStatusFor(sub.status, org?.status);
    payload.plan_key = await partnerPlanKey(sub.tenantId, sub.productId);
    payload.trial_ends_at = sub.trialEndsAt?.toISOString() ?? null;
    payload.cancel_at_period_end = sub.cancelAtPeriodEnd;
    // Event time (retries re-sign with a fresh header timestamp): partners
    // drop anything older than the last state they applied.
    payload.occurred_at = new Date().toISOString();
  }
  return payload;
}

/**
 * Queue a contract-§B subscription event. No-op unless the product belongs
 * to a partner app (partnerForSlug). On activation, also kicks off the one-time provisioning
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
    if (!product) return;
    const target = await partnerForSlug(product.slug);
    if (!target) return;

    await db.insert(webhookDeliveries).values({
      kind: "lifecycle",
      event,
      partnerAppId: target.appId,
      subscriptionId: sub.id,
      target: target.lifecycleUrl ?? "",
      payload: await buildSubscriptionPayload(sub, product.slug, target),
    });

    if (event === "subscription.activated") {
      await ensureProvisionHandshake(sub, product.slug, target);
    }
  } catch (e) {
    console.error(`[webhooks_out] emit ${event} sub=${subscriptionId} failed:`, e);
  }
}

/** Queue organization.updated to every partner the org is in scope for. Never throws. */
export async function emitOrganizationUpdated(orgId: string): Promise<void> {
  try {
    const targets = await orgPartnerTargets(orgId);
    if (targets.length === 0) return;
    const org = await db.query.organization.findFirst({ where: eq(organization.id, orgId) });
    if (!org) return;
    for (const target of targets) {
      await db.insert(webhookDeliveries).values({
        kind: "lifecycle",
        event: "organization.updated",
        partnerAppId: target.appId,
        target: target.lifecycleUrl ?? "",
        payload: { hub_org_id: org.id, name: org.name, slug: org.slug ?? "" },
      });
    }
  } catch (e) {
    console.error(`[webhooks_out] emit organization.updated org=${orgId} failed:`, e);
  }
}

/** Queue membership.changed to in-scope partners that take membership events. Never throws. */
export async function emitMembershipChanged(opts: {
  orgId: string;
  userId: string;
  role: string;
  action: "added" | "updated" | "removed";
}): Promise<void> {
  try {
    const targets = (await orgPartnerTargets(opts.orgId)).filter((t) => t.receivesMembership);
    for (const target of targets) await queueMembershipChanged(target, opts);
  } catch (e) {
    console.error(`[webhooks_out] emit membership.changed org=${opts.orgId} failed:`, e);
  }
}

async function queueMembershipChanged(target: PartnerTarget, opts: {
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
    partnerAppId: target.appId,
    target: target.lifecycleUrl ?? "",
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
 * First activation of a partner-owned subscription: queue the §C handshake
 * (deduped by an existing provision row for the subscription), create the
 * provisioning row (DNS fields stay null), and — for partners that take
 * membership events — replay the current member roster, since those events
 * only start flowing once the org enters the partner's scope.
 */
async function ensureProvisionHandshake(
  sub: SubscriptionRow,
  productSlug: string,
  target: PartnerTarget,
): Promise<void> {
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

  const payload: Record<string, unknown> = {
    hub_subscription_id: sub.id,
    hub_org_id: org.id,
    product_slug: productSlug,
    org_name: org.name,
    org_slug: org.slug ?? "",
    owner_email: owner?.email ?? "",
    owner_name: owner?.name ?? "",
  };
  if (target.extendedPayloads && target.appId) {
    // Set when ops (or the Partner API) linked an existing partner tenant:
    // the partner links it instead of creating a duplicate.
    const external = await externalTenantIdFor(target.appId, org.id);
    if (external) payload.external_tenant_id = external;
  }

  await getOrCreateProvisioning(sub.id);
  await db.insert(webhookDeliveries).values({
    kind: "provision",
    // §C names no event; MHub routes by URL. This value fills the
    // X-Plaidware-Event header and the ops list.
    event: "provision.requested",
    partnerAppId: target.appId,
    subscriptionId: sub.id,
    target: target.provisionUrl ?? "",
    payload,
  });

  if (!target.receivesMembership) return;
  const roster = await db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, org.id));
  for (const m of roster) {
    await queueMembershipChanged(target, {
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

function resolveTarget(row: DeliveryRow, target: PartnerTarget | null): string | null {
  if (!target) return null;
  return row.kind === "provision" ? target.provisionUrl : target.lifecycleUrl;
}

/**
 * Persist a provision response. MHub (§C) answers `{ portal_url, … }`;
 * partner apps answer `{ external_tenant_id, portal_url? }` and the link is
 * recorded. Anything missing is a retry — both receivers are idempotent.
 */
async function applyProvisionResponse(
  row: DeliveryRow,
  target: PartnerTarget,
  parsed: unknown,
): Promise<AttemptOutcome> {
  const body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const portalUrl = typeof body.portal_url === "string" && body.portal_url ? body.portal_url : null;

  if (!target.appId) {
    if (!portalUrl) return { ok: false, permanent: false, error: "2xx but no portal_url in response" };
    if (row.subscriptionId) await setPortalUrl(row.subscriptionId, portalUrl);
    return { ok: true };
  }

  const external =
    typeof body.external_tenant_id === "string" && body.external_tenant_id.trim()
      ? body.external_tenant_id.trim()
      : null;
  if (!external) return { ok: false, permanent: false, error: "2xx but no external_tenant_id in response" };
  const tenantId = typeof row.payload.hub_org_id === "string" ? row.payload.hub_org_id : null;
  if (tenantId) {
    const linked = await linkPartnerTenant({
      partnerAppId: target.appId,
      tenantId,
      externalTenantId: external,
      linkedBy: "provision",
    });
    if (!linked.ok) {
      // Retrying won't fix a conflicting link; dead-letter it for ops.
      return {
        ok: false,
        permanent: true,
        error: `link conflict (${linked.reason}) for external_tenant_id ${external}`,
      };
    }
  }
  if (portalUrl && row.subscriptionId) await setPortalUrl(row.subscriptionId, portalUrl);
  return { ok: true };
}

async function attemptDelivery(row: DeliveryRow, target: PartnerTarget | null): Promise<AttemptOutcome> {
  const url = resolveTarget(row, target);
  const secret = target?.secret;
  if (!target || !url || !secret) {
    return { ok: false, permanent: false, error: "partner target not configured" };
  }
  // §B bodies wrap in {event, data}; the §C handshake body is flat.
  const rawBody =
    row.kind === "provision"
      ? JSON.stringify(row.payload)
      : JSON.stringify({ event: row.event, data: row.payload });
  const timestampSeconds = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
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
      return { ok: false, permanent: true, error: `410 Gone — disabled by ${target.displayName}` };
    }
    if (!res.ok) return { ok: false, permanent: false, error: `HTTP ${res.status}` };
    if (row.kind === "provision") {
      const parsed: unknown = await res.json().catch(() => null);
      return applyProvisionResponse(row, target, parsed);
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
 * Attempt every due pending delivery whose partner is configured. Rows for
 * an unconfigured partner (MHub env unset, app without URL/secret, app
 * disabled) are left alone — they keep queueing and drain once the config
 * lands, rather than burning their retry budget against nothing.
 */
export async function runDueDeliveries(now = new Date()): Promise<SweepResult | { skipped: true }> {
  const targets = await listPartnerTargets();
  const ready = (t: PartnerTarget) => targetConfigured(t, "lifecycle") || targetConfigured(t, "provision");
  const mhubReady = mhubConfigured();
  const appIds = targets.filter((t) => t.appId && ready(t)).map((t) => t.appId as string);
  if (!mhubReady && appIds.length === 0) return { skipped: true };

  const scope = [
    ...(mhubReady ? [isNull(webhookDeliveries.partnerAppId)] : []),
    ...(appIds.length ? [inArray(webhookDeliveries.partnerAppId, appIds)] : []),
  ];
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAttemptAt, now),
        or(...scope),
      ),
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(SWEEP_BATCH_SIZE);
  const byApp = new Map(targets.map((t) => [t.appId, t]));

  const result: SweepResult = { attempted: 0, delivered: 0, retried: 0, dead: 0, disabled: 0 };
  for (const row of due) {
    result.attempted++;
    const target = byApp.get(row.partnerAppId) ?? (await targetForDelivery(row.partnerAppId));
    const outcome = await attemptDelivery(row, target);
    const patch = applyAttemptOutcome(row, outcome, new Date());
    await db
      .update(webhookDeliveries)
      .set({ ...patch, target: resolveTarget(row, target) ?? row.target })
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

/**
 * A Hub workspace hold changed (ops suspended, deactivated or reactivated
 * the client): partner apps fold it into billing_status, so tell each one
 * about its live subscriptions. Never throws.
 */
export async function emitWorkspaceStatusToPartners(tenantId: string): Promise<void> {
  try {
    const live = await db
      .select({ id: subscriptions.id, slug: products.slug })
      .from(subscriptions)
      .innerJoin(products, eq(subscriptions.productId, products.id))
      .where(and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES])));
    for (const s of live) {
      const target = await partnerForSlug(s.slug);
      if (target?.extendedPayloads) await emitSubscriptionLifecycle(s.id, "subscription.updated");
    }
  } catch (e) {
    console.error(`[webhooks_out] workspace status emit org=${tenantId} failed:`, e);
  }
}
