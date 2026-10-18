import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { env } from "../../env";
import { AUTH } from "../../lib/routes";
import { getStripe } from "../../lib/stripe";
import { PLACEHOLDER_PHONE } from "../../lib/phone";
import { tenantStatusAllows, tenantStatusMessage } from "../../policy/tenant-status";
import { writeAudit } from "../audit/service";
import { member, organization, user } from "../auth/schema";
import { LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { subscriptionItems, subscriptions } from "../billing/schema";
import {
  applySubscriptionEvent,
  cancelSubscription,
  changeSubscriptionItems,
  createBillingPortalSession,
  createCheckout,
  setCancelAtPeriodEnd,
} from "../billing/service";
import { productComponents, products } from "../catalog/schema";
import { createTenantWithOwner, uniqueSlug } from "../tenancy/service";
import { PartnerApiError, type PartnerApp } from "./api-http";
import { forgetStripeFacts, partnerSubscriptionFor } from "./api-queries";
import {
  billingStatusFor,
  isAllowedReturnUrl,
  partnerActorLabel,
  planItemChanges,
  slugMatchesPrefixes,
  type ItemChange,
  type PartnerActor,
  type PartnerBillingStatus,
} from "./logic";
import { partnerPayLinks, partnerTenantLinks } from "./schema";
import { hubTenantIdFor, linkPartnerTenant } from "./service";

/**
 * Partner API v1 mutations (docs/PARTNER-API.md). Every money path reuses
 * the billing services Hub's own UI uses; this layer adds partner scoping,
 * the actor in the audit trail, and the no-login pay page links.
 */

/** Stripe's window for paying an incomplete subscription's first invoice is ~23h. */
export const PAY_LINK_TTL_MS = 23 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

function assertReturnUrl(app: PartnerApp, url: string | null | undefined, field: string): void {
  if (url == null) return;
  if (!isAllowedReturnUrl(url, app.allowedReturnOrigins)) {
    throw new PartnerApiError("validation_failed", `${field} must be on one of this app's registered origins`, 400);
  }
}

/** The app's subscription row for this tenant, scoped and ownership-checked. */
async function scopedSubscription(app: PartnerApp, tenantId: string, subscriptionId: string) {
  if (!UUID_RE.test(subscriptionId)) throw new PartnerApiError("not_found", "Subscription not found for this tenant", 404);
  const row = await db
    .select({ sub: subscriptions, slug: products.slug })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.tenantId, tenantId)))
    .then((r) => r[0]);
  if (!row) throw new PartnerApiError("not_found", "Subscription not found for this tenant", 404);
  if (!slugMatchesPrefixes(app.productPrefixes, row.slug)) {
    throw new PartnerApiError("forbidden_scope", "That subscription isn't one of this app's products", 403);
  }
  return row.sub;
}

async function requireWorkspaceWrite(tenantId: string): Promise<{ stripeCustomerId: string | null }> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, tenantId),
    columns: { status: true, stripeCustomerId: true },
  });
  if (!org) throw new PartnerApiError("not_found", "Tenant not found", 404);
  if (!tenantStatusAllows(org.status, "write")) {
    throw new PartnerApiError("workspace_locked", tenantStatusMessage(org.status), 409);
  }
  return org;
}

/** The app's product: the requested slug, or its only active product. */
async function appProduct(app: PartnerApp, slug?: string | null) {
  const all = await db.query.products.findMany({ where: eq(products.isActive, true) });
  const mine = all.filter((p) => slugMatchesPrefixes(app.productPrefixes, p.slug));
  const product = slug ? mine.find((p) => p.slug === slug) : mine.length === 1 ? mine[0] : null;
  if (!product) {
    throw slug && all.some((p) => p.slug === slug)
      ? new PartnerApiError("forbidden_scope", "That product isn't one of this app's products", 403)
      : new PartnerApiError("validation_failed", "product_slug must name one of this app's active products", 400);
  }
  return product;
}

async function tenantOwner(tenantId: string) {
  const [owner] = await db
    .select({ email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, tenantId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);
  return owner ?? null;
}

// ---------------------------------------------------------------------------
// Pay links (/pay/<token>)
// ---------------------------------------------------------------------------

async function mintPayLink(opts: {
  app: PartnerApp;
  tenantId: string;
  subscriptionId: string;
  successUrl: string;
  cancelUrl: string | null;
}): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  await db.insert(partnerPayLinks).values({
    partnerAppId: opts.app.id,
    tenantId: opts.tenantId,
    subscriptionId: opts.subscriptionId,
    tokenHash: hashToken(raw),
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
    expiresAt: new Date(Date.now() + PAY_LINK_TTL_MS),
  });
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}${AUTH.pay(raw)}`;
}

/**
 * What the payment needs right now, read live from Stripe: the first
 * invoice's PaymentIntent, or a trial's SetupIntent. Null when nothing is
 * left to confirm (paid, or the subscription moved on).
 */
async function pendingConfirmation(
  stripeSubscriptionId: string,
): Promise<{ mode: "payment" | "setup"; clientSecret: string; amountDueCents: number } | null> {
  const ss = await getStripe().subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
  });
  if (["canceled", "incomplete_expired"].includes(ss.status)) return null;
  const inv = ss.latest_invoice as Stripe.Invoice | null;
  if (inv && inv.status === "open" && inv.amount_due > 0 && inv.confirmation_secret?.client_secret) {
    return { mode: "payment", clientSecret: inv.confirmation_secret.client_secret, amountDueCents: inv.amount_due };
  }
  const si = ss.pending_setup_intent;
  if (si && typeof si !== "string" && si.client_secret && si.status === "requires_payment_method") {
    return { mode: "setup", clientSecret: si.client_secret, amountDueCents: 0 };
  }
  return null;
}

export type PayPageState =
  | { state: "invalid" }
  | { state: "expired"; cancelUrl: string | null }
  | { state: "done"; successUrl: string }
  | {
      state: "pay";
      appName: string;
      orgName: string;
      productName: string;
      mode: "payment" | "setup";
      clientSecret: string;
      amountDueCents: number;
      trialEndsAt: string | null;
      items: { name: string; kind: string; interval: string | null; intervalCount: number; amountCents: number; quantity: number }[];
      cancelUrl: string | null;
    };

export async function getPayPage(raw: string): Promise<PayPageState> {
  const link = await db.query.partnerPayLinks.findFirst({ where: eq(partnerPayLinks.tokenHash, hashToken(raw)) });
  if (!link) return { state: "invalid" };
  if (link.completedAt) return { state: "done", successUrl: link.successUrl };
  if (link.expiresAt < new Date()) return { state: "expired", cancelUrl: link.cancelUrl };

  const [sub, app, org] = await Promise.all([
    db.query.subscriptions.findFirst({ where: eq(subscriptions.id, link.subscriptionId) }),
    db.query.partnerApps.findFirst({ where: (t, { eq: e }) => e(t.id, link.partnerAppId) }),
    db.query.organization.findFirst({ where: eq(organization.id, link.tenantId) }),
  ]);
  if (!sub || !app || !org || !sub.stripeSubscriptionId) return { state: "invalid" };
  const pending = await pendingConfirmation(sub.stripeSubscriptionId);
  if (!pending) {
    return ["canceled", "expired"].includes(sub.status)
      ? { state: "expired", cancelUrl: link.cancelUrl }
      : { state: "done", successUrl: link.successUrl };
  }
  const [product, items] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.id, sub.productId) }),
    db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, sub.id) }),
  ]);
  return {
    state: "pay",
    appName: app.displayName,
    orgName: org.name,
    productName: product?.name ?? app.displayName,
    ...pending,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    items: items
      .filter((i) => i.status !== "canceled")
      .map((i) => ({
        name: i.name,
        kind: i.kind,
        interval: i.interval,
        intervalCount: i.intervalCount,
        amountCents: i.amountCents,
        quantity: i.quantity,
      })),
    cancelUrl: link.cancelUrl,
  };
}

/**
 * Stripe redirected back (or confirmed in-page): mark the link used and send
 * the owner to the partner. Activation itself arrives by the invoice.paid /
 * subscription webhooks — the partner polls its billing page meanwhile.
 */
export async function completePayLink(raw: string): Promise<string | null> {
  const [row] = await db
    .update(partnerPayLinks)
    .set({ completedAt: new Date() })
    .where(and(eq(partnerPayLinks.tokenHash, hashToken(raw)), isNull(partnerPayLinks.completedAt)))
    .returning({ successUrl: partnerPayLinks.successUrl });
  if (row) {
    const link = await db.query.partnerPayLinks.findFirst({ where: eq(partnerPayLinks.tokenHash, hashToken(raw)) });
    const org = link
      ? await db.query.organization.findFirst({ where: eq(organization.id, link.tenantId), columns: { stripeCustomerId: true } })
      : null;
    forgetStripeFacts(org?.stripeCustomerId); // the card just changed
    return row.successUrl;
  }
  const done = await db.query.partnerPayLinks.findFirst({ where: eq(partnerPayLinks.tokenHash, hashToken(raw)) });
  return done?.successUrl ?? null;
}

// ---------------------------------------------------------------------------
// Start / checkout
// ---------------------------------------------------------------------------

export type CheckoutOutcome = {
  hub_org_id: string;
  billing_status: PartnerBillingStatus;
  payment_url: string | null;
};

/**
 * Make sure the tenant has a subscription to the app's product and return a
 * pay link when something is left to confirm. Idempotent: a live, settled
 * subscription returns no link; an unpaid one gets a fresh link to the same
 * invoice; a closed one starts a new subscription (reactivation, never a
 * second trial). A trial needs no card to start (`cardForTrial` false): the
 * card is added later through /checkout, and a trial that ends without one
 * is invoiced and dunned like any failed renewal.
 */
async function ensureCheckout(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  tenantId: string;
  productSlug?: string | null;
  successUrl: string;
  cancelUrl: string | null;
  cardForTrial: boolean;
}): Promise<CheckoutOutcome> {
  const product = await appProduct(opts.app, opts.productSlug);
  const via = partnerActorLabel(opts.app.name, opts.actor);

  let current = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.tenantId, opts.tenantId),
      eq(subscriptions.productId, product.id),
    ),
    orderBy: (t, { desc }) => [desc(t.subscribedAt)],
  });
  // A first payment that never happened expires at Stripe after ~23h; sync
  // a missed webhook before deciding, so the slot frees up.
  if (current?.status === "incomplete" && current.stripeSubscriptionId) {
    const ss = await getStripe().subscriptions.retrieve(current.stripeSubscriptionId);
    if (ss.status !== "incomplete") {
      await applySubscriptionEvent(ss);
      current = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, current.id) });
    }
  }

  const live = current && LIVE_SUBSCRIPTION_STATUSES.includes(current.status) ? current : null;
  if (live) {
    if (live.status === "trialing" && !opts.cardForTrial) {
      return { hub_org_id: opts.tenantId, billing_status: "trialing", payment_url: null };
    }
    const pending = live.stripeSubscriptionId ? await pendingConfirmation(live.stripeSubscriptionId) : null;
    if (!pending) return { hub_org_id: opts.tenantId, billing_status: billingStatusFor(live.status), payment_url: null };
    const url = await mintPayLink({ ...opts, subscriptionId: live.id });
    return { hub_org_id: opts.tenantId, billing_status: billingStatusFor(live.status), payment_url: url };
  }

  const owner = await tenantOwner(opts.tenantId);
  const result = await createCheckout({
    tenantId: opts.tenantId,
    productId: product.id,
    componentIds: [],
    contact: { email: owner?.email ?? opts.actor.email, name: owner?.name ?? opts.actor.name },
    userId: null,
    skipTrial: Boolean(current), // one trial per tenant and product
    trialEndWithoutCard: "cancel", // no card by trial end → expired, never dunned
  });
  await writeAudit({
    tenantId: opts.tenantId,
    subscriptionId: result.subscriptionId,
    kind: "partner_checkout_started",
    payload: { via, reactivation: Boolean(current) },
  });
  const noCardYet = result.status === "trialing" && !opts.cardForTrial;
  const url =
    result.mode === "none" || noCardYet ? null : await mintPayLink({ ...opts, subscriptionId: result.subscriptionId });
  return { hub_org_id: opts.tenantId, billing_status: billingStatusFor(result.status), payment_url: url };
}

/** POST /tenants — create (or find) the Hub tenant for a partner tenant, then checkout. */
export async function startPartnerTenant(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  externalTenantId: string;
  name: string;
  owner: { email: string; name: string };
  productSlug?: string | null;
  successUrl: string;
  cancelUrl: string | null;
}): Promise<CheckoutOutcome> {
  assertReturnUrl(opts.app, opts.successUrl, "success_url");
  assertReturnUrl(opts.app, opts.cancelUrl, "cancel_url");
  await appProduct(opts.app, opts.productSlug); // validate before creating anything

  let tenantId = await hubTenantIdFor(opts.app.id, opts.externalTenantId);
  if (!tenantId) {
    const email = opts.owner.email.trim().toLowerCase();
    let owner = await db.query.user.findFirst({ where: eq(user.email, email) });
    if (!owner) {
      // Inserted directly, like a setup-link client: no password and no Hub
      // email. The partner app is where this owner signs in.
      const [first, ...rest] = opts.owner.name.trim().split(/\s+/);
      const now = new Date();
      [owner] = await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: opts.owner.name.trim() || email,
          email,
          emailVerified: false,
          firstName: first || "Owner",
          lastName: rest.join(" ") || "-",
          phone: PLACEHOLDER_PHONE,
          platformRole: "customer",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }
    // One partner tenant = one Hub workspace, even when the owner already
    // has others (a multi-shop owner gets one per shop).
    const org = await createTenantWithOwner({
      name: opts.name.trim(),
      slug: await uniqueSlug(opts.name),
      ownerUserId: owner.id,
    });
    const linked = await linkPartnerTenant({
      partnerAppId: opts.app.id,
      tenantId: org.id,
      externalTenantId: opts.externalTenantId,
      linkedBy: "partner_api",
    });
    if (!linked.ok) {
      // A concurrent start won the link; drop ours and continue on theirs.
      await db.delete(organization).where(eq(organization.id, org.id));
      tenantId = await hubTenantIdFor(opts.app.id, opts.externalTenantId);
      if (!tenantId) throw new PartnerApiError("rejected", "Could not link this tenant — retry", 409);
    } else {
      tenantId = org.id;
      const via = partnerActorLabel(opts.app.name, opts.actor);
      await writeAudit({ tenantId, kind: "partner_tenant_created", payload: { via, app: opts.app.displayName } });
      await writeAudit({
        tenantId,
        kind: "partner_link_set",
        payload: { app: opts.app.displayName, externalTenantId: opts.externalTenantId, via },
      });
    }
  }
  return ensureCheckout({ ...opts, tenantId, cardForTrial: false });
}

/** POST /tenants/:ext/checkout — pay link for what's owed, a trial's card, or reactivation. */
export async function partnerCheckout(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  tenantId: string;
  productSlug?: string | null;
  successUrl: string;
  cancelUrl: string | null;
}): Promise<CheckoutOutcome> {
  assertReturnUrl(opts.app, opts.successUrl, "success_url");
  assertReturnUrl(opts.app, opts.cancelUrl, "cancel_url");
  return ensureCheckout({ ...opts, cardForTrial: true });
}

// ---------------------------------------------------------------------------
// Portal, add-ons, cancel
// ---------------------------------------------------------------------------

export async function partnerPortalSession(app: PartnerApp, tenantId: string, returnUrl: string): Promise<string> {
  assertReturnUrl(app, returnUrl, "return_url");
  const found = await partnerSubscriptionFor(app, tenantId);
  if (!found) throw new PartnerApiError("rejected", "Start a subscription before managing payment details", 422);
  return createBillingPortalSession(tenantId, returnUrl);
}

export async function partnerChangeItems(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  tenantId: string;
  subscriptionId: string;
  changes: ItemChange[];
}): Promise<void> {
  const org = await requireWorkspaceWrite(opts.tenantId);
  const sub = await scopedSubscription(opts.app, opts.tenantId, opts.subscriptionId);
  if (!LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) || sub.status === "incomplete") {
    throw new PartnerApiError("rejected", "Add-ons can only change on an active subscription", 422);
  }
  const [items, components] = await Promise.all([
    db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, sub.id) }),
    db.query.productComponents.findMany({
      where: and(eq(productComponents.productId, sub.productId), eq(productComponents.isActive, true)),
    }),
  ]);
  const plan = planItemChanges(
    items,
    components.filter((c) => c.role !== "base" && c.kind !== "metered").map((c) => ({ componentId: c.id, kind: c.kind })),
    opts.changes,
  );
  if ("error" in plan) throw new PartnerApiError("validation_failed", plan.error, 400);
  if (plan.addItems.length === 0 && plan.setQuantities.length === 0) return;
  await changeSubscriptionItems({
    subscriptionId: sub.id,
    addItems: plan.addItems,
    setQuantities: plan.setQuantities,
    actorUserId: null,
    auditPayload: { via: partnerActorLabel(opts.app.name, opts.actor) },
  });
  forgetStripeFacts(org.stripeCustomerId);
}

export async function partnerCancel(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  tenantId: string;
  subscriptionId: string;
  atPeriodEnd: boolean;
  reason: string | null;
}): Promise<void> {
  const org = await requireWorkspaceWrite(opts.tenantId);
  const sub = await scopedSubscription(opts.app, opts.tenantId, opts.subscriptionId);
  const via = partnerActorLabel(opts.app.name, opts.actor);
  if (opts.atPeriodEnd) {
    await setCancelAtPeriodEnd({
      subscriptionId: sub.id,
      cancel: true,
      actorUserId: null,
      auditPayload: { via, ...(opts.reason ? { reason: opts.reason } : {}) },
    });
  } else {
    if (!LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
      throw new PartnerApiError("rejected", "This subscription is already closed", 422);
    }
    await cancelSubscription(sub.id);
    await writeAudit({
      tenantId: opts.tenantId,
      subscriptionId: sub.id,
      kind: "subscription_canceled",
      payload: { via, ...(opts.reason ? { reason: opts.reason } : {}) },
    });
  }
  forgetStripeFacts(org.stripeCustomerId);
}

export async function partnerResume(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  tenantId: string;
  subscriptionId: string;
}): Promise<void> {
  const org = await requireWorkspaceWrite(opts.tenantId);
  const sub = await scopedSubscription(opts.app, opts.tenantId, opts.subscriptionId);
  await setCancelAtPeriodEnd({
    subscriptionId: sub.id,
    cancel: false,
    actorUserId: null,
    auditPayload: { via: partnerActorLabel(opts.app.name, opts.actor) },
  });
  forgetStripeFacts(org.stripeCustomerId);
}

/**
 * PATCH /tenants/:ext — the partner keeps Hub's copy of the shop current:
 * the workspace name and the billing contact (Stripe customer + where Hub's
 * billing emails go). Hub login identities are never changed here.
 */
export async function updatePartnerTenant(opts: {
  app: PartnerApp;
  actor: PartnerActor;
  tenantId: string;
  name?: string;
  billingEmail?: string;
  billingName?: string;
}): Promise<void> {
  const org = await db.query.organization.findFirst({ where: eq(organization.id, opts.tenantId) });
  if (!org) throw new PartnerApiError("not_found", "Tenant not found", 404);
  const changes: Record<string, unknown> = {};
  if (opts.name && opts.name !== org.name) {
    await db.update(organization).set({ name: opts.name }).where(eq(organization.id, org.id));
    changes.name = { before: org.name, after: opts.name };
  }
  if (opts.billingEmail !== undefined || opts.billingName !== undefined) {
    const link = await db.query.partnerTenantLinks.findFirst({
      where: and(eq(partnerTenantLinks.partnerAppId, opts.app.id), eq(partnerTenantLinks.tenantId, org.id)),
    });
    if (link) {
      const next = {
        billingEmail: opts.billingEmail ?? link.billingEmail,
        billingName: opts.billingName ?? link.billingName,
      };
      if (next.billingEmail !== link.billingEmail || next.billingName !== link.billingName) {
        await db.update(partnerTenantLinks).set(next).where(eq(partnerTenantLinks.id, link.id));
        changes.billingContact = { before: link.billingEmail, after: next.billingEmail };
      }
    }
  }
  if (Object.keys(changes).length === 0) return;
  if (org.stripeCustomerId) {
    await getStripe().customers.update(org.stripeCustomerId, {
      ...(changes.name ? { name: opts.name } : {}),
      ...(opts.billingEmail ? { email: opts.billingEmail } : {}),
    });
    forgetStripeFacts(org.stripeCustomerId);
  }
  await writeAudit({
    tenantId: org.id,
    kind: "partner_tenant_updated",
    payload: { via: partnerActorLabel(opts.app.name, opts.actor), ...changes },
  });
}
