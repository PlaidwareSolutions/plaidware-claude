import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { getStripe } from "../../lib/stripe";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { formatCents } from "../../lib/money";
import { formatDate, formatMonth } from "../../lib/dates";
import { env } from "../../env";
import { tenantStatusAllows, tenantStatusMessage } from "../../policy/tenant-status";
import { member, organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import {
  invoices,
  stripeEvents,
  subscriptionItems,
  subscriptions,
  tenantPriceOverrides,
} from "./schema";
import {
  itemMrrCents,
  isRecurringKind,
  LIVE_SUBSCRIPTION_STATUSES,
  mapStripeInvoiceStatus,
  mapStripeSubscriptionStatus,
  resolveInterval,
  type LocalSubscriptionStatus,
} from "./mappers";
import { isOfflinePaymentMethod } from "./payment-methods";
import type { CheckoutItemPlan, StartBackdate } from "./start-logic";
import {
  deleteMintedCoupon,
  recordRedemption,
  reconcileInvoiceDiscounts,
  resolveCheckoutPromo,
} from "../promos/service";
import { payments } from "./ar-schema";
import {
  ensureDunningCase,
  recordPaymentRow,
  resolveDunningForInvoice,
} from "./ar-service";
import { mintIngestKey } from "../monitoring/service";
import { writeAudit } from "../audit/service";
import { emitSubscriptionLifecycle } from "../webhooks_out/service";
import { subscriptionEventForStatusChange } from "../webhooks_out/logic";
import { TENANT } from "@/lib/routes";

// ---------------------------------------------------------------------------
// Stripe object provisioning
// ---------------------------------------------------------------------------

export async function ensureTenantStripeCustomer(
  tenantId: string,
  contact: { email: string; name: string },
): Promise<string> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, tenantId),
  });
  if (!org) throw new Error("Tenant not found");
  if (org.stripeCustomerId) return org.stripeCustomerId;

  const customer = await getStripe().customers.create({
    name: org.name,
    email: contact.email,
    metadata: { tenant_id: tenantId },
  });
  await db
    .update(organization)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organization.id, tenantId));
  return customer.id;
}

async function ensureStripeProductFor(
  component: typeof productComponents.$inferSelect,
  productName: string,
): Promise<string> {
  if (component.stripeProductId) return component.stripeProductId;
  const p = await getStripe().products.create({
    name: `${productName} — ${component.name}`,
    metadata: { component_id: component.id },
  });
  await db
    .update(productComponents)
    .set({ stripeProductId: p.id })
    .where(eq(productComponents.id, component.id));
  return p.id;
}

/** Lazily create the Stripe Product/Price for a component; prices are
 *  immutable, so catalog edits clear stripePriceId and we mint fresh here. */
export async function ensureComponentStripePrice(
  component: typeof productComponents.$inferSelect,
  productName: string,
): Promise<string> {
  if (component.stripePriceId) return component.stripePriceId;
  const stripe = getStripe();
  const stripeProductId = await ensureStripeProductFor(component, productName);
  const iv = resolveInterval(component);
  const price = await stripe.prices.create({
    product: stripeProductId,
    unit_amount: component.amountCents,
    currency: component.currency,
    ...(iv ? { recurring: { interval: iv.interval, interval_count: iv.intervalCount } } : {}),
    metadata: { component_id: component.id },
  });
  await db
    .update(productComponents)
    .set({ stripePriceId: price.id })
    .where(eq(productComponents.id, component.id));
  return price.id;
}

/** Tenant-negotiated price (billing v2): its own lazily minted Stripe Price. */
export async function ensureOverrideStripePrice(
  override: typeof tenantPriceOverrides.$inferSelect,
  component: typeof productComponents.$inferSelect,
  productName: string,
): Promise<string> {
  if (override.stripePriceId) return override.stripePriceId;
  const stripeProductId = await ensureStripeProductFor(component, productName);
  const iv = resolveInterval(component);
  const price = await getStripe().prices.create({
    product: stripeProductId,
    unit_amount: override.amountCents,
    currency: component.currency,
    ...(iv ? { recurring: { interval: iv.interval, interval_count: iv.intervalCount } } : {}),
    metadata: { component_id: component.id, tenant_id: override.tenantId, override: "1" },
  });
  await db
    .update(tenantPriceOverrides)
    .set({ stripePriceId: price.id })
    .where(eq(tenantPriceOverrides.id, override.id));
  return price.id;
}

/**
 * The Stripe Price for a component at a given unit amount: the tenant's
 * override price when it matches, the catalog price at list, else an ad-hoc
 * price minted for this checkout (a negotiated deal not saved as an override).
 */
export async function ensureStripePriceForAmount(
  component: typeof productComponents.$inferSelect,
  productName: string,
  tenantId: string,
  amountCents: number,
  override?: typeof tenantPriceOverrides.$inferSelect,
): Promise<string> {
  if (override && override.amountCents === amountCents) {
    return ensureOverrideStripePrice(override, component, productName);
  }
  if (amountCents === component.amountCents) return ensureComponentStripePrice(component, productName);
  const stripeProductId = await ensureStripeProductFor(component, productName);
  const iv = resolveInterval(component);
  const price = await getStripe().prices.create({
    product: stripeProductId,
    unit_amount: amountCents,
    currency: component.currency,
    ...(iv ? { recurring: { interval: iv.interval, interval_count: iv.intervalCount } } : {}),
    metadata: { component_id: component.id, tenant_id: tenantId, adhoc: "1" },
  });
  return price.id;
}

/** The customer's default card, else the one saved on any of their live Stripe subscriptions. */
export async function findCustomerPaymentMethod(stripeCustomerId: string): Promise<string | null> {
  const stripe = getStripe();
  const customer = (await stripe.customers.retrieve(stripeCustomerId)) as Stripe.Customer;
  const def = customer.invoice_settings?.default_payment_method;
  if (def) return typeof def === "string" ? def : def.id;
  const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 20 });
  for (const s of subs.data) {
    if (["canceled", "incomplete_expired"].includes(s.status)) continue;
    const pm = s.default_payment_method;
    if (pm) return typeof pm === "string" ? pm : pm.id;
  }
  return null;
}

/** Effective per-tenant pricing map for a product's components. */
export async function getTenantOverrides(tenantId: string, componentIds: string[]) {
  if (componentIds.length === 0) return new Map<string, typeof tenantPriceOverrides.$inferSelect>();
  const rows = await db.query.tenantPriceOverrides.findMany({
    where: and(
      eq(tenantPriceOverrides.tenantId, tenantId),
      inArray(tenantPriceOverrides.componentId, componentIds),
    ),
  });
  return new Map(rows.map((r) => [r.componentId, r]));
}

// ---------------------------------------------------------------------------
// Checkout (PRD §4.4)
// ---------------------------------------------------------------------------

export type CheckoutResult = {
  subscriptionId: string;
  clientSecret: string | null;
  /** payment → confirmPayment; setup → confirmSetup (trial, nothing due today) */
  mode: "payment" | "setup" | "none";
  /** Off-session checkouts only: what happened to the first-invoice charge.
   *  requires_action/requires_payment come with clientSecret for on-session recovery. */
  paymentStatus?: "paid" | "requires_action" | "requires_payment";
  appliedPromo: {
    code: string;
    description: string;
    source: "manual" | "auto";
    firstInvoiceSavingsCents: number;
  } | null;
  stripeSubscriptionId: string | null;
  /** Local status at return (an invoice-collected or backdated start is active at once). */
  status: LocalSubscriptionStatus;
  /** The invoice that bills the start — Stripe's own, or the Hub's catch-up when backdated. */
  firstInvoice: CheckoutFirstInvoice | null;
};

export type CheckoutFirstInvoice = {
  stripeInvoiceId: string;
  localInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  amountDueCents: number;
  status: string;
};

/** Ops "start now" without a card: Stripe emails each invoice with a hosted pay link. */
export type CheckoutCollection = { method: "send_invoice"; daysUntilDue: number };
export type CheckoutBackdate = Pick<StartBackdate, "billFromMonth" | "startAt" | "anchorAt" | "lines">;

const toUnix = (d: Date) => Math.floor(d.getTime() / 1000);

export async function createCheckout(opts: {
  tenantId: string;
  productId: string;
  componentIds: string[];
  contact: { email: string; name: string };
  promoCode?: string | null;
  /** Suppress auto-apply promos (client-setup links pass true). */
  skipAutoPromos?: boolean;
  userId?: string | null;
  /** Charge the customer's saved card server-side instead of collecting one
   *  in the browser (multi-product setup links). Money moves only AFTER the
   *  local row has won the one-live-sub-per-product slot. */
  offSession?: { paymentMethodId: string };
  /** Ops-decided terms per component (quantity, explicit unit price, one-time
   *  settlement). Components listed here are selected; base/required still
   *  join automatically. Absent → self-serve rules (quantity 1, overrides). */
  itemPlan?: CheckoutItemPlan[];
  /** Invoice-collected start (no card). */
  collection?: CheckoutCollection;
  skipTrial?: boolean;
  /** Bill calendar months from the past: Stripe starts at `startAt`, bills
   *  from `anchorAt`, and the Hub invoices the elapsed months now. */
  backdate?: CheckoutBackdate;
}): Promise<CheckoutResult> {
  const stripe = getStripe();

  // The workspace must be able to take on new products: a suspended one can
  // pay its way out but not buy, an inactive one can't do either. Checked
  // here so every entry point (self-serve, setup links) shares the rule.
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, opts.tenantId),
    columns: { status: true },
  });
  if (!org) throw new Error("Tenant not found");
  if (!tenantStatusAllows(org.status, "write")) throw new Error(tenantStatusMessage(org.status));

  const product = await db.query.products.findFirst({
    where: eq(products.id, opts.productId),
  });
  if (!product || !product.isActive) throw new Error("Product not found");

  const allComponents = await db.query.productComponents.findMany({
    where: and(
      eq(productComponents.productId, opts.productId),
      eq(productComponents.isActive, true),
    ),
  });
  // The base charge and required add-ons are always in; optional add-ons only
  // when selected (billing v2 main + add-ons model) or planned by ops.
  const plan = new Map((opts.itemPlan ?? []).map((p) => [p.componentId, p]));
  const selected = allComponents.filter(
    (c) => c.role === "base" || c.isRequired || plan.has(c.id) || opts.componentIds.includes(c.id),
  );
  const planOf = (c: (typeof selected)[number]) => plan.get(c.id);
  const settlementOf = (c: (typeof selected)[number]) => planOf(c)?.settlement?.mode ?? "invoice";
  /** Quantity only means something on recurring add-ons. */
  const qty = (c: (typeof selected)[number]) =>
    isRecurringKind(c.kind) && c.role !== "base" ? Math.max(1, Math.floor(planOf(c)?.quantity ?? 1)) : 1;
  const recurring = selected.filter((c) => isRecurringKind(c.kind));
  const oneTime = selected.filter((c) => c.kind === "one_time");
  const oneTimeStripe = oneTime.filter((c) => settlementOf(c) !== "offline");
  const oneTimeOffline = oneTime.filter((c) => settlementOf(c) === "offline");
  if (recurring.length === 0 && oneTime.length === 0) {
    throw new Error("Select at least one billable component");
  }
  if (opts.backdate && recurring.length === 0) throw new Error("Backdating needs a recurring item");
  if (opts.backdate && opts.promoCode) throw new Error("Promo codes can't combine with a backdated start");

  // Per-tenant negotiated prices apply to this checkout (billing v2); an
  // explicit planned price beats them, and a waived one-time item is $0.
  const overrides = await getTenantOverrides(opts.tenantId, selected.map((c) => c.id));
  const effectiveAmount = (c: (typeof selected)[number]) => {
    const p = planOf(c);
    if (p?.settlement?.mode === "waive") return 0;
    return p?.amountCents ?? overrides.get(c.id)?.amountCents ?? c.amountCents;
  };

  // Pre-check the one-live-subscription rule for a friendly error;
  // the partial unique index is the race-proof backstop.
  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.tenantId, opts.tenantId),
      eq(subscriptions.productId, opts.productId),
      inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
    ),
  });
  if (existing) {
    throw new Error(`You already have an active ${product.name} subscription.`);
  }

  const customerId = await ensureTenantStripeCustomer(opts.tenantId, opts.contact);
  const priceIds = new Map<string, string>();
  for (const c of selected) {
    if (settlementOf(c) === "offline") continue; // paid outside Stripe — no price needed
    priceIds.set(
      c.id,
      await ensureStripePriceForAmount(c, product.name, opts.tenantId, effectiveAmount(c), overrides.get(c.id)),
    );
  }

  // Promo: an explicitly typed code always wins. AUTO-apply promos are
  // suppressed when the tenant has negotiated (override) pricing on any
  // selected item, or when the caller opts out (client-setup links) — a
  // negotiated deal must never be silently discounted further.
  const negotiated =
    [...overrides.keys()].some((id) => selected.some((c) => c.id === id)) ||
    selected.some((c) => planOf(c)?.amountCents != null && planOf(c)!.amountCents !== c.amountCents);
  const allowAuto = !negotiated && !opts.skipAutoPromos;
  const promosOn = env.PROMOS_ENABLED === "true" && !opts.backdate;
  const resolvedPromo =
    promosOn && (opts.promoCode || allowAuto)
      ? await resolveCheckoutPromo({
          tenantId: opts.tenantId,
          productId: opts.productId,
          items: selected
            .filter((c) => settlementOf(c) !== "offline")
            .map((c) => ({
              componentId: c.id,
              kind: c.kind,
              amountCents: effectiveAmount(c) * qty(c),
            })),
          code: opts.promoCode,
        })
      : null;

  let stripeSubscriptionId: string | null = null;
  let clientSecret: string | null = null;
  let mode: CheckoutResult["mode"] = "none";
  let trialEndsAt: Date | null = null;
  let localStatus: LocalSubscriptionStatus = "incomplete";
  let firstInvoiceId: string | null = null;
  let firstInvoiceDueCents = 0;
  let firstInvoice: CheckoutFirstInvoice | null = null;
  /** Standalone Stripe invoices made in this call — voided on failure. */
  const madeInvoiceIds: string[] = [];
  const allOffline = recurring.length === 0 && oneTimeStripe.length === 0;
  const collectionParams = opts.collection
    ? { collection_method: "send_invoice" as const, days_until_due: opts.collection.daysUntilDue }
    : null;

  try {
    if (recurring.length > 0) {
      const trialDays = opts.skipTrial || opts.backdate ? 0 : (product.trialDays ?? 0);
      const sub = await stripe.subscriptions.create({
        customer: customerId,
        items: recurring.map((c) => ({ price: priceIds.get(c.id)!, quantity: qty(c) })),
        billing_mode: { type: "flexible" },
        ...(collectionParams ?? {
          payment_behavior: "default_incomplete" as const,
          payment_settings: { save_default_payment_method: "on_subscription" as const },
          ...(opts.offSession ? { default_payment_method: opts.offSession.paymentMethodId } : {}),
        }),
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        ...(opts.backdate
          ? {
              // Stripe records the true start and bills from the anchor; the
              // elapsed months (and one-time work) go on the catch-up invoice below.
              backdate_start_date: toUnix(opts.backdate.startAt),
              billing_cycle_anchor: toUnix(opts.backdate.anchorAt),
              proration_behavior: "none" as const,
            }
          : {
              // One-time components ride the first invoice (PRD §4.4)
              add_invoice_items: oneTimeStripe.map((c) => ({ price: priceIds.get(c.id)!, quantity: qty(c) })),
            }),
        ...(resolvedPromo
          ? { discounts: [{ coupon: resolvedPromo.stripeCouponId }] }
          : {}),
        expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
      });
      stripeSubscriptionId = sub.id;
      // Mirror Stripe: a trial with a required one-time fee starts
      // `incomplete` and flips to `trialing` when that fee is paid; an
      // invoice-collected or backdated start is active at once.
      if (sub.status === "trialing") localStatus = "trialing";
      else if (sub.status === "active") localStatus = "active";
      trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
      const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
      firstInvoiceId = latestInvoice?.id ?? null;
      firstInvoiceDueCents = latestInvoice?.amount_due ?? 0;
      const confirmation = latestInvoice?.confirmation_secret ?? null;
      if (opts.collection) {
        mode = "none"; // nothing to confirm in the browser — Stripe emails the invoice
      } else if (confirmation?.client_secret) {
        clientSecret = confirmation.client_secret;
        mode = "payment";
      } else if (
        sub.pending_setup_intent &&
        typeof sub.pending_setup_intent !== "string"
      ) {
        clientSecret = sub.pending_setup_intent.client_secret;
        mode = "setup";
      }
      if (latestInvoice) {
        firstInvoice = {
          stripeInvoiceId: latestInvoice.id!,
          localInvoiceId: null,
          hostedInvoiceUrl: latestInvoice.hosted_invoice_url ?? null,
          amountDueCents: latestInvoice.amount_due,
          status: latestInvoice.status ?? "draft",
        };
      }
    } else if (allOffline) {
      // Everything was paid outside Stripe: no Stripe objects, live at once.
      localStatus = "active";
    }

    // Insert the local row inside the try so a unique-violation race
    // triggers Stripe cleanup below.
    const [subRow] = await db
      .insert(subscriptions)
      .values({
        tenantId: opts.tenantId,
        productId: opts.productId,
        status: localStatus,
        stripeSubscriptionId,
        trialEndsAt,
        ...(opts.backdate ? { subscribedAt: opts.backdate.startAt } : {}),
      })
      .returning();

    // A trial or an ops start is live immediately — MHub gets its activation
    // now, not at first payment (webhooks_out no-ops for non-marketing products).
    if (localStatus !== "incomplete") {
      await emitSubscriptionLifecycle(subRow.id, "subscription.activated");
    }

    if (recurring.length === 0 && !allOffline) {
      // One-time-only purchase: finalized invoice + PaymentIntent, no subscription.
      const invoice = await stripe.invoices.create({
        customer: customerId,
        auto_advance: false,
        ...(collectionParams ?? {}),
        ...(resolvedPromo
          ? { discounts: [{ coupon: resolvedPromo.stripeCouponId }] }
          : {}),
        metadata: { subscription_id: subRow.id, tenant_id: opts.tenantId },
      });
      madeInvoiceIds.push(invoice.id!);
      for (const c of oneTimeStripe) {
        await stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          pricing: { price: priceIds.get(c.id)! },
          quantity: qty(c),
        });
      }
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id!, {
        expand: ["confirmation_secret"],
      });
      if (opts.collection) await stripe.invoices.sendInvoice(finalized.id!).catch(() => {});
      firstInvoiceId = finalized.id ?? null;
      firstInvoiceDueCents = finalized.amount_due;
      clientSecret = opts.collection ? null : (finalized.confirmation_secret?.client_secret ?? null);
      mode = clientSecret ? "payment" : "none";
      firstInvoice = {
        stripeInvoiceId: finalized.id!,
        localInvoiceId: null,
        hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        amountDueCents: finalized.amount_due,
        status: finalized.status ?? "open",
      };
    } else if (stripeSubscriptionId) {
      // Tag the Stripe subscription with our id so webhooks route directly.
      await stripe.subscriptions.update(stripeSubscriptionId, {
        metadata: { subscription_id: subRow.id, tenant_id: opts.tenantId },
      });
    }

    if (opts.backdate && stripeSubscriptionId) {
      // Backdated start: the catch-up (elapsed months + one-time work) is a
      // Hub-made invoice tied to the subscription — Stripe issues none itself
      // when the cycle anchor is ahead and prorations are off (verified in
      // scripts/spike-backdate.ts).
      const bd = opts.backdate;
      const description = `${product.name} — billed from ${formatMonth(bd.billFromMonth)}`;
      const invoice = await stripe.invoices.create({
        customer: customerId,
        subscription: stripeSubscriptionId,
        auto_advance: false,
        ...(collectionParams ?? { collection_method: "charge_automatically" as const }),
        description,
        metadata: {
          subscription_id: subRow.id,
          tenant_id: opts.tenantId,
          catch_up: "1",
          bill_from_month: bd.billFromMonth,
        },
      });
      madeInvoiceIds.push(invoice.id!);
      for (const l of bd.lines) {
        await stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          description: l.name,
          amount: l.cents,
          currency: "usd",
          period: { start: toUnix(l.periodStart), end: toUnix(l.periodEnd) },
          metadata: {
            component_id: l.componentId,
            quantity: String(l.quantity),
            unit_amount_cents: String(l.unitCents),
            catch_up: "1",
          },
        });
      }
      for (const c of oneTimeStripe) {
        await stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          pricing: { price: priceIds.get(c.id)! },
          quantity: qty(c),
        });
      }
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id!, {
        expand: ["confirmation_secret"],
      });
      if (opts.collection) await stripe.invoices.sendInvoice(finalized.id!).catch(() => {});
      firstInvoiceId = finalized.id ?? null;
      firstInvoiceDueCents = finalized.amount_due;
      // Card paths pay this invoice: off-session below, or on-session when no
      // setup intent was offered. A setup link keeps mode "setup" — the card
      // is saved first and finalize charges the open invoice.
      if (!opts.collection && !clientSecret && finalized.confirmation_secret?.client_secret) {
        clientSecret = finalized.confirmation_secret.client_secret;
        mode = "payment";
      }
      const [row] = await db
        .insert(invoices)
        .values({
          tenantId: opts.tenantId,
          subscriptionId: subRow.id,
          kind: "product",
          invoiceNumber: finalized.number ?? `INV-${finalized.id!.slice(-8).toUpperCase()}`,
          status: "open",
          amountDueCents: finalized.amount_due,
          currency: finalized.currency,
          description,
          billingMonth: bd.billFromMonth, // marks a catch-up invoice (product kind)
          lineItems: [
            ...bd.lines.map((l) => ({
              name: l.name,
              amountCents: l.cents,
              quantity: l.quantity,
              unitAmountCents: l.unitCents,
              periodStart: l.periodStart.toISOString(),
              periodEnd: l.periodEnd.toISOString(),
            })),
            ...oneTimeStripe.map((c) => ({
              name: c.name,
              amountCents: effectiveAmount(c) * qty(c),
              quantity: qty(c),
              unitAmountCents: effectiveAmount(c),
            })),
          ],
          stripeInvoiceId: finalized.id!,
          hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
          invoicePdfUrl: finalized.invoice_pdf ?? null,
          periodStart: bd.startAt,
          periodEnd: bd.anchorAt,
          dueDate: finalized.due_date ? new Date(finalized.due_date * 1000) : null,
        })
        .onConflictDoNothing({ target: invoices.stripeInvoiceId })
        .returning({ id: invoices.id });
      firstInvoice = {
        stripeInvoiceId: finalized.id!,
        localInvoiceId: row?.id ?? null,
        hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        amountDueCents: finalized.amount_due,
        status: finalized.status ?? "open",
      };
    } else if (opts.collection && firstInvoice && stripeSubscriptionId) {
      // Invoice-collected start: mirror Stripe's first invoice now so ops can
      // record a payment before the webhook lands.
      const stripeInv = await stripe.invoices.retrieve(firstInvoice.stripeInvoiceId, { expand: ["lines"] });
      const [row] = await db
        .insert(invoices)
        .values({
          tenantId: opts.tenantId,
          subscriptionId: subRow.id,
          kind: "product",
          invoiceNumber: stripeInv.number ?? `INV-${stripeInv.id!.slice(-8).toUpperCase()}`,
          status: mapStripeInvoiceStatus(stripeInv.status, "invoice.created"),
          amountDueCents: stripeInv.amount_due,
          currency: stripeInv.currency,
          description: stripeInv.description,
          lineItems: stripeInv.lines.data.map((l) => ({
            name: l.description ?? "Line item",
            amountCents: l.amount,
            quantity: l.quantity ?? 1,
            ...(l.period
              ? {
                  periodStart: new Date(l.period.start * 1000).toISOString(),
                  periodEnd: new Date(l.period.end * 1000).toISOString(),
                }
              : {}),
          })),
          stripeInvoiceId: stripeInv.id!,
          hostedInvoiceUrl: stripeInv.hosted_invoice_url ?? null,
          invoicePdfUrl: stripeInv.invoice_pdf ?? null,
          periodStart: stripeInv.period_start ? new Date(stripeInv.period_start * 1000) : null,
          periodEnd: stripeInv.period_end ? new Date(stripeInv.period_end * 1000) : null,
          dueDate: stripeInv.due_date ? new Date(stripeInv.due_date * 1000) : null,
        })
        .onConflictDoNothing({ target: invoices.stripeInvoiceId })
        .returning({ id: invoices.id });
      firstInvoice = {
        ...firstInvoice,
        localInvoiceId: row?.id ?? null,
        hostedInvoiceUrl: stripeInv.hosted_invoice_url ?? firstInvoice.hostedInvoiceUrl,
        status: stripeInv.status ?? firstInvoice.status,
      };
    }

    // Snapshot line items at purchase prices.
    const stripeSub = stripeSubscriptionId
      ? await stripe.subscriptions.retrieve(stripeSubscriptionId)
      : null;
    await db.insert(subscriptionItems).values(
      selected.map((c) => {
        const iv = resolveInterval(c);
        const offline = settlementOf(c) === "offline";
        return {
          subscriptionId: subRow.id,
          componentId: c.id,
          kind: c.kind,
          interval: iv?.interval ?? null,
          intervalCount: iv?.intervalCount ?? 1,
          name: c.name,
          amountCents: effectiveAmount(c),
          quantity: qty(c),
          currency: c.currency,
          status:
            c.kind === "one_time"
              ? offline
                ? ("paid" as const)
                : ("pending" as const)
              : ("active" as const),
          stripePriceId: priceIds.get(c.id) ?? null,
          stripeSubscriptionItemId:
            stripeSub?.items.data.find(
              (si) => si.price.id === priceIds.get(c.id),
            )?.id ?? null,
        };
      }),
    );

    // Offline-paid invoices made when a setup link was created now belong to
    // this subscription (local row + Stripe metadata, best effort).
    for (const c of oneTimeOffline) {
      const s = planOf(c)?.settlement;
      if (s?.mode !== "offline" || !s.invoiceId) continue;
      const [linked] = await db
        .update(invoices)
        .set({ subscriptionId: subRow.id })
        .where(and(eq(invoices.id, s.invoiceId), eq(invoices.tenantId, opts.tenantId), isNull(invoices.subscriptionId)))
        .returning({ stripeInvoiceId: invoices.stripeInvoiceId });
      if (linked?.stripeInvoiceId) {
        await stripe.invoices
          .update(linked.stripeInvoiceId, { metadata: { subscription_id: subRow.id } })
          .catch(() => {});
      }
    }

    // Every subscription gets an ingest credential at birth (PRD §4.8).
    void mintIngestKey(subRow.id).catch(() => {});

    if (resolvedPromo) {
      await recordRedemption({
        resolved: resolvedPromo,
        tenantId: opts.tenantId,
        subscriptionId: subRow.id,
        userId: opts.userId ?? null,
      });
    }

    // Off-session: charge the saved card now that the local row has committed.
    // A failed charge is a returnable outcome, never a reason for cleanup —
    // an unpaid incomplete sub self-expires in ~23h (existing hygiene).
    let paymentStatus: CheckoutResult["paymentStatus"];
    if (opts.offSession) {
      if (!firstInvoiceId || firstInvoiceDueCents <= 0) {
        // Trial / nothing due today; the saved default PM covers renewals.
        paymentStatus = "paid";
        mode = "none";
        clientSecret = null;
      } else {
        try {
          await stripe.invoices.pay(firstInvoiceId, {
            payment_method: opts.offSession.paymentMethodId,
            off_session: true,
          });
          paymentStatus = "paid";
          mode = "none";
          clientSecret = null;
          if (firstInvoice) firstInvoice = { ...firstInvoice, status: "paid" };
        } catch (err) {
          const code = (err as { code?: string })?.code ?? "";
          const msg = err instanceof Error ? err.message : String(err);
          if (code === "invoice_already_paid" || /already paid/i.test(msg)) {
            paymentStatus = "paid";
            mode = "none";
            clientSecret = null;
          } else if (code === "authentication_required") {
            paymentStatus = "requires_action"; // clientSecret drives handleNextAction
          } else {
            paymentStatus = "requires_payment"; // clientSecret drives PaymentElement
          }
        }
      }
    }

    return {
      subscriptionId: subRow.id,
      clientSecret,
      mode,
      paymentStatus,
      stripeSubscriptionId,
      status: localStatus,
      firstInvoice,
      appliedPromo: resolvedPromo
        ? {
            code: resolvedPromo.promo.code,
            description: resolvedPromo.discount.description,
            source: resolvedPromo.source,
            firstInvoiceSavingsCents: resolvedPromo.discount.firstInvoiceCents,
          }
        : null,
    };
  } catch (e) {
    // Race-safe compensation: never leave orphaned Stripe billing objects.
    await deleteMintedCoupon(resolvedPromo);
    for (const id of madeInvoiceIds) {
      await stripe.invoices.voidInvoice(id).catch(() => stripe.invoices.del(id).catch(() => {}));
    }
    if (stripeSubscriptionId) {
      await stripe.subscriptions
        .cancel(stripeSubscriptionId)
        .catch((err) => console.error("[checkout] orphan cancel failed:", err));
    }
    const isUnique =
      typeof e === "object" && e !== null && "code" in e && e.code === "23505";
    throw isUnique
      ? new Error(`You already have an active ${product.name} subscription.`)
      : e;
  }
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
  });
  if (!sub) throw new Error("Subscription not found");
  if (sub.stripeSubscriptionId) {
    await getStripe().subscriptions.cancel(sub.stripeSubscriptionId);
    // Webhook confirms; set local state immediately for responsive UI.
  }
  await db
    .update(subscriptions)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      suspensionSource: null,
      suspendedAt: null,
      suspensionNote: null,
    })
    .where(eq(subscriptions.id, subscriptionId));
  await db
    .update(subscriptionItems)
    .set({ status: "canceled" })
    .where(
      and(
        eq(subscriptionItems.subscriptionId, subscriptionId),
        notInArray(subscriptionItems.status, ["paid"]),
      ),
    );
  await emitSubscriptionLifecycle(subscriptionId, "subscription.canceled");
}

/**
 * Mid-subscription add-on changes (billing v2). Recurring changes prorate
 * immediately; one-time add-ons are invoiced and charged right away.
 */
export async function changeSubscriptionItems(opts: {
  subscriptionId: string;
  addComponentIds?: string[];
  /** Ops: add with a quantity; an add-on already on the subscription grows by it (prorated). */
  addItems?: { componentId: string; quantity?: number }[];
  removeItemIds?: string[];
  actorUserId: string;
}): Promise<{ added: number; removed: number }> {
  const stripe = getStripe();
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.id, opts.subscriptionId),
  });
  if (!sub) throw new Error("Subscription not found");
  if (!LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
    throw new Error("Add-ons can only change on a live subscription");
  }
  const product = await db.query.products.findFirst({
    where: eq(products.id, sub.productId),
  });
  const existingItems = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, sub.id),
  });
  let added = 0;
  let removed = 0;

  // ---- removals: optional recurring add-ons only, prorated credit ----------
  for (const itemId of opts.removeItemIds ?? []) {
    const item = existingItems.find((i) => i.id === itemId);
    if (!item || item.status !== "active") continue;
    const component = item.componentId
      ? await db.query.productComponents.findFirst({
          where: eq(productComponents.id, item.componentId),
        })
      : null;
    if (component?.role === "base") throw new Error("The base charge can't be removed — cancel the subscription instead.");
    if (!isRecurringKind(item.kind) || !item.stripeSubscriptionItemId) continue;
    await stripe.subscriptionItems.del(item.stripeSubscriptionItemId, {
      proration_behavior: "create_prorations",
    });
    await db
      .update(subscriptionItems)
      .set({ status: "canceled" })
      .where(eq(subscriptionItems.id, item.id));
    removed++;
  }

  // ---- additions ------------------------------------------------------------
  const adds = [
    ...(opts.addComponentIds ?? []).map((componentId) => ({ componentId, quantity: 1 })),
    ...(opts.addItems ?? []).map((a) => ({
      componentId: a.componentId,
      quantity: Math.max(1, Math.floor(a.quantity ?? 1)),
    })),
  ];
  const overrides = await getTenantOverrides(sub.tenantId, adds.map((a) => a.componentId));
  for (const { componentId, quantity: wanted } of adds) {
    const c = await db.query.productComponents.findFirst({
      where: eq(productComponents.id, componentId),
    });
    if (!c || !c.isActive || c.productId !== sub.productId) {
      throw new Error("That add-on doesn't belong to this product");
    }
    const quantity = isRecurringKind(c.kind) && c.role !== "base" ? wanted : 1;
    const current = existingItems.find((i) => i.componentId === c.id && ["active", "pending"].includes(i.status));
    if (current) {
      // Already on the subscription: a live recurring add-on grows by the
      // asked quantity (prorated); anything else is a no-op.
      if (!isRecurringKind(c.kind) || c.role === "base" || current.status !== "active" || !current.stripeSubscriptionItemId) {
        continue;
      }
      const next = current.quantity + quantity;
      await stripe.subscriptionItems.update(current.stripeSubscriptionItemId, {
        quantity: next,
        proration_behavior: "create_prorations",
      });
      await db.update(subscriptionItems).set({ quantity: next }).where(eq(subscriptionItems.id, current.id));
      added++;
      continue;
    }
    const ov = overrides.get(c.id);
    const priceId = ov
      ? await ensureOverrideStripePrice(ov, c, product?.name ?? "Plaidware")
      : await ensureComponentStripePrice(c, product?.name ?? "Plaidware");
    const amount = ov?.amountCents ?? c.amountCents;
    const iv = resolveInterval(c);

    if (isRecurringKind(c.kind)) {
      if (!sub.stripeSubscriptionId) throw new Error("This subscription has no Stripe billing to attach recurring add-ons to");
      const si = await stripe.subscriptionItems.create({
        subscription: sub.stripeSubscriptionId,
        price: priceId,
        quantity,
        proration_behavior: "create_prorations",
      });
      await db.insert(subscriptionItems).values({
        subscriptionId: sub.id,
        componentId: c.id,
        kind: c.kind,
        interval: iv?.interval ?? null,
        intervalCount: iv?.intervalCount ?? 1,
        name: c.name,
        amountCents: amount,
        quantity,
        currency: c.currency,
        status: "active",
        stripePriceId: priceId,
        stripeSubscriptionItemId: si.id,
      });
    } else {
      // One-time add-on: standalone invoice, charged immediately when a card
      // is on file (owner decision), else hosted payment link.
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, sub.tenantId),
      });
      const customer = (await stripe.customers.retrieve(org!.stripeCustomerId!)) as Stripe.Customer;
      const hasPm = Boolean(customer.invoice_settings?.default_payment_method);
      const invoice = await stripe.invoices.create({
        customer: org!.stripeCustomerId!,
        ...(hasPm
          ? { collection_method: "charge_automatically" as const, auto_advance: true }
          : { collection_method: "send_invoice" as const, days_until_due: 7 }),
        description: `${c.name} — added to ${product?.name ?? "subscription"}`,
        metadata: { subscription_id: sub.id, tenant_id: sub.tenantId },
      });
      await stripe.invoiceItems.create({
        customer: org!.stripeCustomerId!,
        invoice: invoice.id,
        pricing: { price: priceId },
        quantity,
      });
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
      if (hasPm) await stripe.invoices.pay(finalized.id!).catch(() => {});
      else await stripe.invoices.sendInvoice(finalized.id!).catch(() => {});
      // Mirror immediately (same pattern as manual invoices); the webhook
      // upserts on stripe_invoice_id and keeps status current.
      await db
        .insert(invoices)
        .values({
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          kind: "product",
          invoiceNumber: finalized.number ?? `ADD-${finalized.id!.slice(-8).toUpperCase()}`,
          status: "open",
          amountDueCents: finalized.amount_due,
          currency: finalized.currency,
          description: `${c.name} — added mid-subscription`,
          lineItems: [{ name: c.name, amountCents: amount * quantity, quantity, unitAmountCents: amount }],
          stripeInvoiceId: finalized.id!,
          hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
          invoicePdfUrl: finalized.invoice_pdf ?? null,
          dueDate: finalized.due_date ? new Date(finalized.due_date * 1000) : null,
        })
        .onConflictDoNothing({ target: invoices.stripeInvoiceId });
      await db.insert(subscriptionItems).values({
        subscriptionId: sub.id,
        componentId: c.id,
        kind: c.kind,
        name: c.name,
        amountCents: amount,
        quantity,
        currency: c.currency,
        status: "pending", // flips to paid via the invoice.paid webhook
        stripePriceId: priceId,
      });
    }
    added++;
  }

  await writeAudit({
    tenantId: sub.tenantId,
    subscriptionId: sub.id,
    actorUserId: opts.actorUserId,
    kind: "subscription_items_changed",
    payload: { added, removed },
  });
  if (added || removed) {
    await emitSubscriptionLifecycle(sub.id, "subscription.updated");
  }
  return { added, removed };
}

export async function createBillingPortalSession(
  tenantId: string,
  returnUrl: string,
): Promise<string> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, tenantId),
  });
  if (!org?.stripeCustomerId) {
    throw new Error("No billing profile yet — complete a purchase first.");
  }
  const session = await getStripe().billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Webhook processing (PRD §4.5) — idempotent via stripe_events ledger
// ---------------------------------------------------------------------------

/** Returns false when the event was already processed. */
export async function claimStripeEvent(id: string, type: string): Promise<boolean> {
  const inserted = await db
    .insert(stripeEvents)
    .values({ id, type })
    .onConflictDoNothing()
    .returning({ id: stripeEvents.id });
  return inserted.length > 0;
}

async function resolveSubscriptionRef(ref: {
  stripeSubscriptionId?: string | null;
  localSubscriptionId?: string | null;
}) {
  if (ref.localSubscriptionId) {
    const row = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, ref.localSubscriptionId),
    });
    if (row) return row;
  }
  if (ref.stripeSubscriptionId) {
    return db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, ref.stripeSubscriptionId),
    });
  }
  return undefined;
}

export async function applyInvoiceEvent(
  invoice: Stripe.Invoice,
  eventType: string,
): Promise<void> {
  const parentSub = invoice.parent?.subscription_details;
  const stripeSubId =
    typeof parentSub?.subscription === "string"
      ? parentSub.subscription
      : (parentSub?.subscription?.id ?? null);
  const localSub = await resolveSubscriptionRef({
    stripeSubscriptionId: stripeSubId,
    localSubscriptionId: invoice.metadata?.subscription_id,
  });
  const tenantId =
    localSub?.tenantId ?? invoice.metadata?.tenant_id ?? null;
  if (!tenantId) {
    console.warn(`[webhook] invoice ${invoice.id}: no tenant resolvable, skipping`);
    return;
  }

  const status = mapStripeInvoiceStatus(invoice.status, eventType);
  const metaKind = invoice.metadata?.invoice_kind;
  const values = {
    tenantId,
    subscriptionId:
      localSub?.id ?? (invoice.metadata?.subscription_id || null),
    kind: (metaKind === "hosting" || metaKind === "manual"
      ? metaKind
      : "product") as "product" | "hosting" | "manual",
    billingMonth: invoice.metadata?.billing_month ?? null,
    invoiceNumber: invoice.number ?? `INV-${invoice.id!.slice(-8).toUpperCase()}`,
    status,
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    currency: invoice.currency,
    description: invoice.description,
    lineItems: (invoice.lines?.data ?? []).map((l) => ({
      name: l.description ?? "Line item",
      amountCents: l.amount,
      quantity: l.quantity ?? 1,
      ...(l.period
        ? {
            periodStart: new Date(l.period.start * 1000).toISOString(),
            periodEnd: new Date(l.period.end * 1000).toISOString(),
          }
        : {}),
    })),
    stripeInvoiceId: invoice.id!,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
    paidAt: status === "paid" ? new Date() : null,
  };

  const [localInvoice] = await db
    .insert(invoices)
    .values(values)
    .onConflictDoUpdate({
      target: invoices.stripeInvoiceId,
      set: {
        status: values.status,
        amountDueCents: values.amountDueCents,
        amountPaidCents: values.amountPaidCents,
        lineItems: values.lineItems,
        hostedInvoiceUrl: values.hostedInvoiceUrl,
        invoicePdfUrl: values.invoicePdfUrl,
        // An echo never moves a paid date ops already set (offline payments).
        paidAt: sql`coalesce(${invoices.paidAt}, excluded.paid_at)`,
      },
    })
    .returning({ id: invoices.id });

  // An invoice the Hub settled out-of-band (cash, check…) says nothing about
  // the subscription's other items or its activation — only Stripe-collected
  // money does.
  const settledOffline = invoice.metadata?.settlement === "offline";
  if (status === "paid") {
    if (localSub && !settledOffline) {
      await onInvoicePaid(localSub);
      // Savings ledger: accumulate the actual discounted dollars (PRD §4.6).
      await reconcileInvoiceDiscounts(invoice, localSub.id);
    }
    // Payments ledger: Stripe-collected money (skip out-of-band marks —
    // those were recorded by ops when the offline payment came in).
    if (localInvoice && invoice.amount_paid > 0) {
      const already = await db.query.payments.findFirst({
        where: eq(payments.invoiceId, localInvoice.id),
      });
      if (!already) {
        const metaMethod = invoice.metadata?.payment_method;
        await recordPaymentRow({
          invoiceId: localInvoice.id,
          tenantId,
          amountCents: invoice.amount_paid,
          method: settledOffline && metaMethod && isOfflinePaymentMethod(metaMethod) ? metaMethod : "stripe_card",
          reference: invoice.id ?? null,
          sendReceipt: true,
        });
      }
    }
    if (localInvoice) await resolveDunningForInvoice(localInvoice.id);
  }
  if (status === "failed" && localInvoice) {
    await ensureDunningCase(localInvoice.id, tenantId);
  }
}

/** Promote the subscription's saved card to the customer's default payment
 *  method so hosting/manual/add-on invoices can auto-charge (billing v2). */
export async function promoteDefaultPaymentMethod(sub: typeof subscriptions.$inferSelect) {
  try {
    const stripe = getStripe();
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, sub.tenantId),
    });
    if (!org?.stripeCustomerId || !sub.stripeSubscriptionId) return;
    const customer = (await stripe.customers.retrieve(org.stripeCustomerId)) as Stripe.Customer;
    if (customer.invoice_settings?.default_payment_method) return; // already set
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const pm =
      typeof stripeSub.default_payment_method === "string"
        ? stripeSub.default_payment_method
        : stripeSub.default_payment_method?.id;
    if (!pm) return;
    await stripe.customers.update(org.stripeCustomerId, {
      invoice_settings: { default_payment_method: pm },
    });
  } catch (e) {
    console.warn("[billing] default-pm promotion skipped:", e instanceof Error ? e.message : e);
  }
}

async function onInvoicePaid(sub: typeof subscriptions.$inferSelect) {
  await promoteDefaultPaymentMethod(sub);
  // One-time items settle with the first paid invoice.
  await db
    .update(subscriptionItems)
    .set({ status: "paid" })
    .where(
      and(
        eq(subscriptionItems.subscriptionId, sub.id),
        eq(subscriptionItems.status, "pending"),
      ),
    );
  if (sub.status === "incomplete") {
    await db
      .update(subscriptions)
      .set({ status: "active" })
      .where(eq(subscriptions.id, sub.id));
    await emitSubscriptionLifecycle(sub.id, "subscription.activated");
  }

  // Checkout confirmation on the FIRST paid invoice (old-app gap, PRD §4.13).
  const paidCount = await db.query.invoices.findMany({
    where: and(eq(invoices.subscriptionId, sub.id), eq(invoices.status, "paid")),
    columns: { id: true },
  });
  if (paidCount.length <= 1) {
    const [product, owner] = await Promise.all([
      db.query.products.findFirst({ where: eq(products.id, sub.productId) }),
      db
        .select({ email: user.email, name: user.name })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(and(eq(member.organizationId, sub.tenantId), eq(member.role, "owner")))
        .limit(1),
    ]);
    if (owner[0] && product) {
      void sendEmail({
        to: owner[0].email,
        subject: `Welcome to ${product.name}`,
        html: emailShell(
          `${product.name} is on the way`,
          `<p>Your payment is confirmed and your ${product.name} subscription is active. We're getting things ready — track everything from your dashboard.</p>` +
            emailButton(`${env.APP_BASE_URL}${TENANT.dashboard}`, "Open dashboard"),
        ),
      });
    }
  }
}

export async function applySubscriptionEvent(
  stripeSub: Stripe.Subscription,
): Promise<void> {
  const localSub = await resolveSubscriptionRef({
    stripeSubscriptionId: stripeSub.id,
    localSubscriptionId: stripeSub.metadata?.subscription_id,
  });
  if (!localSub) {
    console.warn(`[webhook] subscription ${stripeSub.id}: no local row, skipping`);
    return;
  }
  const periodEnds = stripeSub.items.data
    .map((i) => i.current_period_end)
    .filter(Boolean);
  const periodStarts = stripeSub.items.data
    .map((i) => i.current_period_start)
    .filter(Boolean);
  const prevStatus = localSub.status;
  const stripeStatus = mapStripeSubscriptionStatus(stripeSub.status);
  // A Hub-side hold (dunning or manual) is not Stripe's to lift: while Stripe
  // still reports the subscription live, the local status stays suspended —
  // payment resolution or an ops reactivation clears it. Terminal states win.
  const holdSurvives =
    prevStatus === "suspended" && ["active", "trialing", "past_due"].includes(stripeStatus);
  const nextStatus = holdSurvives ? prevStatus : stripeStatus;
  const closed = nextStatus === "canceled" || nextStatus === "expired";

  await db
    .update(subscriptions)
    .set({
      status: nextStatus,
      ...(closed ? { suspensionSource: null, suspendedAt: null, suspensionNote: null } : {}),
      stripeSubscriptionId: stripeSub.id,
      currentPeriodStart: periodStarts.length
        ? new Date(Math.min(...periodStarts) * 1000)
        : null,
      currentPeriodEnd: periodEnds.length
        ? new Date(Math.max(...periodEnds) * 1000)
        : null,
      trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
    })
    .where(eq(subscriptions.id, localSub.id));

  // Reconcile recurring items so mid-cycle changes made anywhere stay
  // mirrored: a Stripe item that vanished cancels the local row, a changed
  // quantity (Dashboard edit) wins over the local one.
  const stripeQty = new Map(stripeSub.items.data.map((i) => [i.id, i.quantity ?? 1]));
  const localItems = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, localSub.id),
  });
  for (const item of localItems) {
    if (item.status !== "active" || !item.stripeSubscriptionItemId) continue;
    if (!stripeQty.has(item.stripeSubscriptionItemId)) {
      await db
        .update(subscriptionItems)
        .set({ status: "canceled" })
        .where(eq(subscriptionItems.id, item.id));
    } else if (stripeQty.get(item.stripeSubscriptionItemId) !== item.quantity) {
      await db
        .update(subscriptionItems)
        .set({ quantity: stripeQty.get(item.stripeSubscriptionItemId)! })
        .where(eq(subscriptionItems.id, item.id));
    }
  }

  // MHub lifecycle: status transitions map to their contract event; a
  // same-status Stripe update on a live sub still means data moved (period
  // end, items) → subscription.updated. Emitted after item reconciliation so
  // the payload carries the settled add-on list.
  const lifecycleEvent =
    subscriptionEventForStatusChange(prevStatus, nextStatus) ??
    (nextStatus === "active" || nextStatus === "trialing" ? "subscription.updated" : null);
  if (lifecycleEvent) {
    await emitSubscriptionLifecycle(localSub.id, lifecycleEvent);
  }
}

/** invoice.upcoming → renewal notice to billing contacts (billing v2). */
export async function sendUpcomingRenewalReminder(invoice: Stripe.Invoice): Promise<void> {
  const parentSub = invoice.parent?.subscription_details;
  const stripeSubId =
    typeof parentSub?.subscription === "string"
      ? parentSub.subscription
      : (parentSub?.subscription?.id ?? null);
  const localSub = await resolveSubscriptionRef({
    stripeSubscriptionId: stripeSubId,
    localSubscriptionId: invoice.metadata?.subscription_id,
  });
  if (!localSub) return;
  const [product, owner] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.id, localSub.productId) }),
    db
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, localSub.tenantId), inArray(member.role, ["owner", "admin", "billing"])))
      .limit(1),
  ]);
  if (!owner[0]) return;
  const lines = (invoice.lines?.data ?? [])
    .map((l) => `<li>${l.description ?? "Line item"} — ${formatCents(l.amount)}</li>`)
    .join("");
  const dueTs = invoice.next_payment_attempt ?? invoice.due_date ?? invoice.period_end;
  await sendEmail({
    to: owner[0].email,
    subject: `Upcoming ${product?.name ?? "subscription"} renewal — ${formatCents(invoice.amount_due)}`,
    html: emailShell(
      "Your renewal is coming up",
      `<p>Your ${product?.name ?? "Plaidware"} subscription renews${dueTs ? ` on ${formatDate(dueTs * 1000)}` : " soon"}. Your card on file will be charged automatically — nothing to do.</p><ul>${lines}</ul><p><strong>Total: ${formatCents(invoice.amount_due)}</strong></p>` +
        emailButton(`${env.APP_BASE_URL}${TENANT.billing}`, "View billing"),
    ),
  });
}

export async function sendTrialEndingReminder(stripeSub: Stripe.Subscription) {
  const localSub = await resolveSubscriptionRef({
    stripeSubscriptionId: stripeSub.id,
    localSubscriptionId: stripeSub.metadata?.subscription_id,
  });
  if (!localSub) return;
  const [product, owner] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.id, localSub.productId) }),
    db
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        and(eq(member.organizationId, localSub.tenantId), eq(member.role, "owner")),
      )
      .limit(1),
  ]);
  if (!owner[0] || !product) return;
  const items = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, localSub.id),
  });
  const monthly = items
    .filter((i) => isRecurringKind(i.kind) && i.status === "active")
    .reduce((s, i) => s + itemMrrCents(i, i.amountCents * i.quantity), 0);
  await sendEmail({
    to: owner[0].email,
    subject: `Your ${product.name} trial ends in 3 days`,
    html: emailShell(
      "Trial ending soon",
      `<p>Your free trial of ${product.name} ends in 3 days. Your saved payment method will then be charged${monthly ? ` ${formatCents(monthly)}/month` : ""} automatically. Nothing to do if you'd like to continue.</p>` +
        emailButton(`${env.APP_BASE_URL}${TENANT.billing}`, "Manage billing"),
    ),
  });
}
