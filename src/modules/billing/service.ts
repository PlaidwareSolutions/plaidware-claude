import { and, eq, inArray, notInArray } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { getStripe } from "../../lib/stripe";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { formatCents } from "../../lib/money";
import { env } from "../../env";
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
  isRecurringKind,
  LIVE_SUBSCRIPTION_STATUSES,
  mapStripeInvoiceStatus,
  mapStripeSubscriptionStatus,
  resolveInterval,
} from "./mappers";
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
};

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
}): Promise<CheckoutResult> {
  const stripe = getStripe();

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
  // when selected (billing v2 main + add-ons model).
  const selected = allComponents.filter(
    (c) => c.role === "base" || c.isRequired || opts.componentIds.includes(c.id),
  );
  const recurring = selected.filter((c) => isRecurringKind(c.kind));
  const oneTime = selected.filter((c) => c.kind === "one_time");
  if (recurring.length === 0 && oneTime.length === 0) {
    throw new Error("Select at least one billable component");
  }

  // Per-tenant negotiated prices apply to this checkout (billing v2).
  const overrides = await getTenantOverrides(opts.tenantId, selected.map((c) => c.id));
  const effectiveAmount = (c: (typeof selected)[number]) =>
    overrides.get(c.id)?.amountCents ?? c.amountCents;

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
    const ov = overrides.get(c.id);
    priceIds.set(
      c.id,
      ov
        ? await ensureOverrideStripePrice(ov, c, product.name)
        : await ensureComponentStripePrice(c, product.name),
    );
  }

  // Promo: an explicitly typed code always wins. AUTO-apply promos are
  // suppressed when the tenant has negotiated (override) pricing on any
  // selected item, or when the caller opts out (client-setup links) — a
  // negotiated deal must never be silently discounted further.
  const negotiated = [...overrides.keys()].some((id) => selected.some((c) => c.id === id));
  const allowAuto = !negotiated && !opts.skipAutoPromos;
  const promosOn = env.PROMOS_ENABLED === "true";
  const resolvedPromo =
    promosOn && (opts.promoCode || allowAuto)
      ? await resolveCheckoutPromo({
          tenantId: opts.tenantId,
          productId: opts.productId,
          items: selected.map((c) => ({
            componentId: c.id,
            kind: c.kind,
            amountCents: effectiveAmount(c),
          })),
          code: opts.promoCode,
        })
      : null;

  let stripeSubscriptionId: string | null = null;
  let clientSecret: string | null = null;
  let mode: CheckoutResult["mode"] = "none";
  let trialEndsAt: Date | null = null;
  let localStatus: "incomplete" | "trialing" = "incomplete";
  let firstInvoiceId: string | null = null;
  let firstInvoiceDueCents = 0;

  try {
    if (recurring.length > 0) {
      const trialDays = product.trialDays ?? 0;
      const sub = await stripe.subscriptions.create({
        customer: customerId,
        items: recurring.map((c) => ({ price: priceIds.get(c.id)! })),
        billing_mode: { type: "flexible" },
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        ...(opts.offSession
          ? { default_payment_method: opts.offSession.paymentMethodId }
          : {}),
        ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
        // One-time components ride the first invoice (PRD §4.4)
        add_invoice_items: oneTime.map((c) => ({ price: priceIds.get(c.id)! })),
        ...(resolvedPromo
          ? { discounts: [{ coupon: resolvedPromo.stripeCouponId }] }
          : {}),
        expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
      });
      stripeSubscriptionId = sub.id;
      // Mirror Stripe: a trial with a required one-time fee starts
      // `incomplete` and flips to `trialing` when that fee is paid.
      if (sub.status === "trialing") localStatus = "trialing";
      trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
      const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
      firstInvoiceId = latestInvoice?.id ?? null;
      firstInvoiceDueCents = latestInvoice?.amount_due ?? 0;
      const confirmation = latestInvoice?.confirmation_secret ?? null;
      if (confirmation?.client_secret) {
        clientSecret = confirmation.client_secret;
        mode = "payment";
      } else if (
        sub.pending_setup_intent &&
        typeof sub.pending_setup_intent !== "string"
      ) {
        clientSecret = sub.pending_setup_intent.client_secret;
        mode = "setup";
      }
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
      })
      .returning();

    if (recurring.length === 0) {
      // One-time-only purchase: finalized invoice + PaymentIntent, no subscription.
      const invoice = await stripe.invoices.create({
        customer: customerId,
        auto_advance: false,
        ...(resolvedPromo
          ? { discounts: [{ coupon: resolvedPromo.stripeCouponId }] }
          : {}),
        metadata: { subscription_id: subRow.id, tenant_id: opts.tenantId },
      });
      for (const c of oneTime) {
        await stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          pricing: { price: priceIds.get(c.id)! },
        });
      }
      const finalized = await stripe.invoices.finalizeInvoice(invoice.id!, {
        expand: ["confirmation_secret"],
      });
      firstInvoiceId = finalized.id ?? null;
      firstInvoiceDueCents = finalized.amount_due;
      clientSecret = finalized.confirmation_secret?.client_secret ?? null;
      mode = clientSecret ? "payment" : "none";
    } else if (stripeSubscriptionId) {
      // Tag the Stripe subscription with our id so webhooks route directly.
      await stripe.subscriptions.update(stripeSubscriptionId, {
        metadata: { subscription_id: subRow.id, tenant_id: opts.tenantId },
      });
    }

    // Snapshot line items at purchase prices.
    const stripeSub = stripeSubscriptionId
      ? await stripe.subscriptions.retrieve(stripeSubscriptionId)
      : null;
    await db.insert(subscriptionItems).values(
      selected.map((c) => {
        const iv = resolveInterval(c);
        return {
          subscriptionId: subRow.id,
          componentId: c.id,
          kind: c.kind,
          interval: iv?.interval ?? null,
          intervalCount: iv?.intervalCount ?? 1,
          name: c.name,
          amountCents: effectiveAmount(c),
          currency: c.currency,
          status: c.kind === "one_time" ? ("pending" as const) : ("active" as const),
          stripePriceId: priceIds.get(c.id),
          stripeSubscriptionItemId:
            stripeSub?.items.data.find(
              (si) => si.price.id === priceIds.get(c.id),
            )?.id ?? null,
        };
      }),
    );

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
    .set({ status: "canceled", canceledAt: new Date() })
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
}

/**
 * Mid-subscription add-on changes (billing v2). Recurring changes prorate
 * immediately; one-time add-ons are invoiced and charged right away.
 */
export async function changeSubscriptionItems(opts: {
  subscriptionId: string;
  addComponentIds?: string[];
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
  const overrides = await getTenantOverrides(sub.tenantId, opts.addComponentIds ?? []);
  for (const componentId of opts.addComponentIds ?? []) {
    const c = await db.query.productComponents.findFirst({
      where: eq(productComponents.id, componentId),
    });
    if (!c || !c.isActive || c.productId !== sub.productId) {
      throw new Error("That add-on doesn't belong to this product");
    }
    if (existingItems.some((i) => i.componentId === c.id && ["active", "pending"].includes(i.status))) {
      continue; // already on the subscription
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
          lineItems: [{ name: c.name, amountCents: amount }],
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
        paidAt: values.paidAt,
      },
    })
    .returning({ id: invoices.id });

  if (status === "paid") {
    if (localSub) {
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
        await recordPaymentRow({
          invoiceId: localInvoice.id,
          tenantId,
          amountCents: invoice.amount_paid,
          method: "stripe_card",
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
            emailButton(`${env.APP_BASE_URL}/dashboard`, "Open dashboard"),
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

  await db
    .update(subscriptions)
    .set({
      status: mapStripeSubscriptionStatus(stripeSub.status),
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

  // Reconcile recurring items so mid-cycle changes made anywhere stay mirrored.
  const liveStripeItemIds = new Set(stripeSub.items.data.map((i) => i.id));
  const localItems = await db.query.subscriptionItems.findMany({
    where: eq(subscriptionItems.subscriptionId, localSub.id),
  });
  for (const item of localItems) {
    if (
      item.status === "active" &&
      item.stripeSubscriptionItemId &&
      !liveStripeItemIds.has(item.stripeSubscriptionItemId)
    ) {
      await db
        .update(subscriptionItems)
        .set({ status: "canceled" })
        .where(eq(subscriptionItems.id, item.id));
    }
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
      `<p>Your ${product?.name ?? "Plaidware"} subscription renews${dueTs ? ` on ${new Date(dueTs * 1000).toLocaleDateString()}` : " soon"}. Your card on file will be charged automatically — nothing to do.</p><ul>${lines}</ul><p><strong>Total: ${formatCents(invoice.amount_due)}</strong></p>` +
        emailButton(`${env.APP_BASE_URL}/billing`, "View billing"),
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
    .filter((i) => i.kind === "recurring_monthly" && i.status === "active")
    .reduce((s, i) => s + i.amountCents, 0);
  await sendEmail({
    to: owner[0].email,
    subject: `Your ${product.name} trial ends in 3 days`,
    html: emailShell(
      "Trial ending soon",
      `<p>Your free trial of ${product.name} ends in 3 days. Your saved payment method will then be charged${monthly ? ` ${formatCents(monthly)}/month` : ""} automatically. Nothing to do if you'd like to continue.</p>` +
        emailButton(`${env.APP_BASE_URL}/billing`, "Manage billing"),
    ),
  });
}
