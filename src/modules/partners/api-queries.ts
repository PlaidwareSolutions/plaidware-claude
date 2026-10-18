import { and, desc, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { getStripe, stripeConfigured } from "../../lib/stripe";
import { normalizeTenantStatus } from "../../policy/tenant-status";
import { organization } from "../auth/schema";
import { itemMrrCents, LIVE_SUBSCRIPTION_STATUSES } from "../billing/mappers";
import { invoices, subscriptionItems, subscriptions, tenantPriceOverrides } from "../billing/schema";
import { productComponents, products } from "../catalog/schema";
import { billingStatusFor, slugMatchesPrefixes, type PartnerBillingStatus, type PartnerPlanKey } from "./logic";
import { partnerPlanKey } from "./service";
import type { partnerApps } from "./schema";

/**
 * Partner API v1 read side (docs/PARTNER-API.md). Everything is scoped to
 * the app's product prefixes: a tenant's other Hub products, their invoices
 * and their prices never reach the partner.
 */

type PartnerApp = typeof partnerApps.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;

export type PartnerInvoiceDto = {
  id: string;
  number: string;
  status: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  created_at: string;
  due_date: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
};

export type PartnerBillingSummaryDto = {
  hub_org_id: string;
  external_tenant_id: string;
  billing_status: PartnerBillingStatus;
  workspace_status: "active" | "suspended" | "inactive";
  subscription: null | {
    hub_subscription_id: string;
    product_slug: string;
    product_name: string;
    plan_key: PartnerPlanKey;
    status: string;
    trial_ends_at: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    canceled_at: string | null;
    suspension: null | { source: string; since: string | null; note: string | null };
    monthly_total_cents: number;
    items: {
      id: string;
      component_id: string | null;
      name: string;
      role: "base" | "addon";
      kind: string;
      interval: string | null;
      interval_count: number;
      unit_amount_cents: number;
      quantity: number;
      status: string;
    }[];
    addon_options: {
      component_id: string;
      name: string;
      kind: string;
      interval: string | null;
      unit_amount_cents: number;
      current_quantity: number;
    }[];
  };
  payment_method: null | { brand: string; last4: string; exp_month: number; exp_year: number };
  collection_method: "charge_automatically" | "send_invoice" | null;
  next_charge: null | { date: string; amount_cents: number };
  invoices: PartnerInvoiceDto[];
};

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** The app's subscriptions for a tenant, newest first, with their product. */
async function appSubscriptions(app: PartnerApp, tenantId: string) {
  const rows = await db
    .select({ sub: subscriptions, slug: products.slug, productName: products.name })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.subscribedAt));
  return rows.filter((r) => slugMatchesPrefixes(app.productPrefixes, r.slug));
}

/**
 * The one subscription the partner sees: the live one when there is one
 * (one live per product is DB-enforced), else the most recent closed one so
 * a canceled shop still sees its history and can reactivate.
 */
export async function partnerSubscriptionFor(
  app: PartnerApp,
  tenantId: string,
): Promise<{ sub: SubscriptionRow; slug: string; productName: string } | null> {
  const rows = await appSubscriptions(app, tenantId);
  return rows.find((r) => LIVE_SUBSCRIPTION_STATUSES.includes(r.sub.status)) ?? rows[0] ?? null;
}

function toInvoiceDto(r: typeof invoices.$inferSelect): PartnerInvoiceDto {
  return {
    id: r.id,
    number: r.invoiceNumber,
    status: r.status,
    amount_due_cents: r.amountDueCents,
    amount_paid_cents: r.amountPaidCents,
    created_at: r.createdAt.toISOString(),
    due_date: iso(r.dueDate),
    paid_at: iso(r.paidAt),
    period_start: iso(r.periodStart),
    period_end: iso(r.periodEnd),
    hosted_invoice_url: r.hostedInvoiceUrl,
    invoice_pdf_url: r.invoicePdfUrl,
  };
}

/** Invoices for the app's subscriptions only, newest first. */
export async function listPartnerInvoices(
  app: PartnerApp,
  tenantId: string,
  opts: { limit: number; offset: number },
): Promise<{ invoices: PartnerInvoiceDto[]; hasMore: boolean }> {
  const subIds = (await appSubscriptions(app, tenantId)).map((r) => r.sub.id);
  if (subIds.length === 0) return { invoices: [], hasMore: false };
  const rows = await db.query.invoices.findMany({
    where: and(eq(invoices.tenantId, tenantId), inArray(invoices.subscriptionId, subIds)),
    orderBy: [desc(invoices.createdAt), desc(invoices.id)],
    limit: opts.limit + 1,
    offset: opts.offset,
  });
  return { invoices: rows.slice(0, opts.limit).map(toInvoiceDto), hasMore: rows.length > opts.limit };
}

// ---------------------------------------------------------------------------
// Stripe facts (card, collection, next charge) — cached briefly per tenant:
// the partner's billing page may poll after a payment.
// ---------------------------------------------------------------------------

type StripeFacts = Pick<PartnerBillingSummaryDto, "payment_method" | "collection_method" | "next_charge">;
const STRIPE_FACTS_TTL_MS = 60_000;
const factsCache = new Map<string, { at: number; facts: StripeFacts }>();

const NO_FACTS: StripeFacts = { payment_method: null, collection_method: null, next_charge: null };

function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): StripeFacts["payment_method"] {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return { brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year };
}

async function loadStripeFacts(stripeCustomerId: string | null, sub: SubscriptionRow | null): Promise<StripeFacts> {
  if (!stripeConfigured() || !stripeCustomerId) return NO_FACTS;
  const key = `${stripeCustomerId}:${sub?.id ?? ""}:${sub?.status ?? ""}`;
  const hit = factsCache.get(key);
  if (hit && Date.now() - hit.at < STRIPE_FACTS_TTL_MS) return hit.facts;

  const stripe = getStripe();
  const live = sub?.stripeSubscriptionId && LIVE_SUBSCRIPTION_STATUSES.includes(sub.status) ? sub.stripeSubscriptionId : null;
  try {
    const [customer, stripeSub, preview] = await Promise.all([
      stripe.customers.retrieve(stripeCustomerId, { expand: ["invoice_settings.default_payment_method"] }),
      live ? stripe.subscriptions.retrieve(live, { expand: ["default_payment_method"] }) : Promise.resolve(null),
      live && sub?.status !== "incomplete"
        ? stripe.invoices.createPreview({ subscription: live }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const customerPm =
      "deleted" in customer && customer.deleted ? null : (customer as Stripe.Customer).invoice_settings?.default_payment_method;
    const payment_method = cardOf(stripeSub?.default_payment_method) ?? cardOf(customerPm);
    // A trial without a card ends (expires) instead of charging, so it has
    // no next charge to show.
    const noChargeComing = stripeSub?.cancel_at_period_end || (stripeSub?.status === "trialing" && !payment_method);
    const facts: StripeFacts = {
      payment_method,
      collection_method: stripeSub?.collection_method ?? null,
      // The renewal invoice is drafted at the current period end.
      next_charge:
        preview && sub?.currentPeriodEnd && !noChargeComing
          ? { date: sub.currentPeriodEnd.toISOString(), amount_cents: preview.amount_due }
          : null,
    };
    factsCache.set(key, { at: Date.now(), facts });
    return facts;
  } catch (e) {
    console.error("[partners] stripe facts lookup failed:", e);
    return NO_FACTS;
  }
}

/** Drop cached Stripe facts after a mutation so the next read is fresh. */
export function forgetStripeFacts(stripeCustomerId: string | null | undefined): void {
  if (!stripeCustomerId) return;
  for (const k of factsCache.keys()) if (k.startsWith(`${stripeCustomerId}:`)) factsCache.delete(k);
}

// ---------------------------------------------------------------------------

export async function getPartnerBillingSummary(
  app: PartnerApp,
  tenantId: string,
  externalTenantId: string,
): Promise<PartnerBillingSummaryDto> {
  const [org, found] = await Promise.all([
    db.query.organization.findFirst({ where: eq(organization.id, tenantId) }),
    partnerSubscriptionFor(app, tenantId),
  ]);
  if (!org) throw new Error("Tenant not found");
  const sub = found?.sub ?? null;

  let subscription: PartnerBillingSummaryDto["subscription"] = null;
  if (found && sub) {
    const [items, allComponents, overrides] = await Promise.all([
      db.query.subscriptionItems.findMany({ where: eq(subscriptionItems.subscriptionId, sub.id) }),
      db.query.productComponents.findMany({ where: eq(productComponents.productId, sub.productId) }),
      db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, tenantId) }),
    ]);
    const components = allComponents.filter((c) => c.isActive);
    const roleOf = (componentId: string | null) =>
      allComponents.find((c) => c.id === componentId)?.role === "base" ? "base" : "addon";
    const shown = items.filter((i) => i.status !== "canceled");
    const live = LIVE_SUBSCRIPTION_STATUSES.includes(sub.status);
    const price = (c: (typeof components)[number]) =>
      overrides.find((o) => o.componentId === c.id)?.amountCents ?? c.amountCents;

    subscription = {
      hub_subscription_id: sub.id,
      product_slug: found.slug,
      product_name: found.productName,
      plan_key: await partnerPlanKey(tenantId, sub.productId),
      status: sub.status,
      trial_ends_at: iso(sub.trialEndsAt),
      current_period_end: iso(sub.currentPeriodEnd),
      cancel_at_period_end: sub.cancelAtPeriodEnd,
      canceled_at: iso(sub.canceledAt),
      suspension:
        sub.status === "suspended"
          ? { source: sub.suspensionSource ?? "dunning", since: iso(sub.suspendedAt), note: sub.suspensionNote }
          : null,
      monthly_total_cents: live
        ? shown
            .filter((i) => i.status === "active")
            .reduce((sum, i) => sum + itemMrrCents(i, i.amountCents * i.quantity), 0)
        : 0,
      items: shown.map((i) => ({
        id: i.id,
        component_id: i.componentId,
        name: i.name,
        role: roleOf(i.componentId),
        kind: i.kind,
        interval: i.interval,
        interval_count: i.intervalCount,
        unit_amount_cents: i.amountCents,
        quantity: i.quantity,
        status: i.status,
      })),
      addon_options: live
        ? components
            .filter((c) => c.role !== "base" && c.kind !== "metered")
            .map((c) => ({
              component_id: c.id,
              name: c.name,
              kind: c.kind,
              interval: c.interval,
              unit_amount_cents: price(c),
              current_quantity: items
                .filter((i) => i.componentId === c.id && i.status === "active")
                .reduce((n, i) => n + i.quantity, 0),
            }))
        : [],
    };
  }

  const [facts, recent] = await Promise.all([
    loadStripeFacts(org.stripeCustomerId, sub),
    listPartnerInvoices(app, tenantId, { limit: 20, offset: 0 }),
  ]);

  return {
    hub_org_id: org.id,
    external_tenant_id: externalTenantId,
    billing_status: billingStatusFor(sub?.status ?? null, org.status),
    workspace_status: normalizeTenantStatus(org.status),
    subscription,
    ...facts,
    invoices: recent.invoices,
  };
}
