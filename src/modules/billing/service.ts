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
} from "./schema";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  mapStripeInvoiceStatus,
  mapStripeSubscriptionStatus,
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

const KIND_INTERVAL: Record<string, "month" | "year" | null> = {
  recurring_monthly: "month",
  recurring_yearly: "year",
  one_time: null,
  metered: null,
};

/** Lazily create the Stripe Product/Price for a component; prices are
 *  immutable, so catalog edits clear stripePriceId and we mint fresh here. */
export async function ensureComponentStripePrice(
  component: typeof productComponents.$inferSelect,
  productName: string,
): Promise<string> {
  if (component.stripePriceId) return component.stripePriceId;
  const stripe = getStripe();

  let stripeProductId = component.stripeProductId;
  if (!stripeProductId) {
    const p = await stripe.products.create({
      name: `${productName} — ${component.name}`,
      metadata: { component_id: component.id },
    });
    stripeProductId = p.id;
  }

  const interval = KIND_INTERVAL[component.kind];
  const price = await stripe.prices.create({
    product: stripeProductId,
    unit_amount: component.amountCents,
    currency: component.currency,
    ...(interval ? { recurring: { interval } } : {}),
    metadata: { component_id: component.id },
  });

  await db
    .update(productComponents)
    .set({ stripeProductId, stripePriceId: price.id })
    .where(eq(productComponents.id, component.id));
  return price.id;
}

// ---------------------------------------------------------------------------
// Checkout (PRD §4.4)
// ---------------------------------------------------------------------------

export type CheckoutResult = {
  subscriptionId: string;
  clientSecret: string | null;
  /** payment → confirmPayment; setup → confirmSetup (trial, nothing due today) */
  mode: "payment" | "setup" | "none";
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
  userId?: string | null;
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
  // Required components are always in; optional only when selected.
  const selected = allComponents.filter(
    (c) => c.isRequired || opts.componentIds.includes(c.id),
  );
  const recurring = selected.filter(
    (c) => c.kind === "recurring_monthly" || c.kind === "recurring_yearly",
  );
  const oneTime = selected.filter((c) => c.kind === "one_time");
  if (recurring.length === 0 && oneTime.length === 0) {
    throw new Error("Select at least one billable component");
  }

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
    priceIds.set(c.id, await ensureComponentStripePrice(c, product.name));
  }

  // Promo: explicit code wins; otherwise best auto-apply. Never stacks (PRD §4.6).
  const resolvedPromo = await resolveCheckoutPromo({
    tenantId: opts.tenantId,
    productId: opts.productId,
    items: selected.map((c) => ({
      componentId: c.id,
      kind: c.kind,
      amountCents: c.amountCents,
    })),
    code: opts.promoCode,
  });

  let stripeSubscriptionId: string | null = null;
  let clientSecret: string | null = null;
  let mode: CheckoutResult["mode"] = "none";
  let trialEndsAt: Date | null = null;
  let localStatus: "incomplete" | "trialing" = "incomplete";

  try {
    if (recurring.length > 0) {
      const trialDays = product.trialDays ?? 0;
      const sub = await stripe.subscriptions.create({
        customer: customerId,
        items: recurring.map((c) => ({ price: priceIds.get(c.id)! })),
        billing_mode: { type: "flexible" },
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
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
      selected.map((c) => ({
        subscriptionId: subRow.id,
        componentId: c.id,
        kind: c.kind,
        name: c.name,
        amountCents: c.amountCents,
        currency: c.currency,
        status: c.kind === "one_time" ? ("pending" as const) : ("active" as const),
        stripePriceId: priceIds.get(c.id),
        stripeSubscriptionItemId:
          stripeSub?.items.data.find(
            (si) => si.price.id === priceIds.get(c.id),
          )?.id ?? null,
      })),
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

    return {
      subscriptionId: subRow.id,
      clientSecret,
      mode,
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

async function onInvoicePaid(sub: typeof subscriptions.$inferSelect) {
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
