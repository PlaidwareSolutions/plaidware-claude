import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { getStripe, stripeConfigured } from "../../lib/stripe";
import { member, organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { listAllProductsOps } from "../catalog/queries";
import { subscriptionProvisioning } from "../provisioning/schema";
import { dunningStates, payments } from "./ar-schema";
import { invoices, subscriptionItems, subscriptions, tenantPriceOverrides, type InvoiceLineItem } from "./schema";
import { intervalLabel, isRecurringKind, itemMrrCents, LIVE_SUBSCRIPTION_STATUSES, MRR_STATUSES } from "./mappers";

export type SubscriptionItemDto = {
  id: string;
  kind: string;
  interval: string | null;
  intervalCount: number;
  name: string;
  /** Unit price; the line is amountCents × quantity. */
  amountCents: number;
  quantity: number;
  status: string;
};

export type SubscriptionDto = {
  id: string;
  status: string;
  productId: string;
  productName: string;
  productSlug: string;
  productColor: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  subscribedAt: string;
  monthlyCents: number;
  domainUrl: string | null;
  items: SubscriptionItemDto[];
  stripeSubscriptionId: string | null;
  /** Standalone monthly hosting fee (null = none); first billed month as YYYY-MM. */
  monthlyHostingCents: number | null;
  hostingBillingStartMonth: string | null;
  /** 'dunning' | 'manual' while suspended, else null. */
  suspensionSource: string | null;
  suspendedAt: string | null;
  suspensionNote: string | null;
  /** The product's suggested hosting fee — shown in the dialog, never auto-applied. */
  defaultMonthlyHostingCents: number | null;
};

export async function listTenantSubscriptions(tenantId: string): Promise<SubscriptionDto[]> {
  const subs = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      productId: subscriptions.productId,
      productName: products.name,
      productSlug: products.slug,
      productColor: products.color,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      subscribedAt: subscriptions.subscribedAt,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      monthlyHostingCents: subscriptions.monthlyHostingCents,
      hostingBillingStartMonth: subscriptions.hostingBillingStartMonth,
      suspensionSource: subscriptions.suspensionSource,
      suspendedAt: subscriptions.suspendedAt,
      suspensionNote: subscriptions.suspensionNote,
      defaultMonthlyHostingCents: products.defaultMonthlyHostingCents,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.subscribedAt));
  if (subs.length === 0) return [];

  const [items, provRows] = await Promise.all([
    db.query.subscriptionItems.findMany({
      where: inArray(subscriptionItems.subscriptionId, subs.map((s) => s.id)),
    }),
    db.query.subscriptionProvisioning.findMany({
      where: inArray(subscriptionProvisioning.subscriptionId, subs.map((s) => s.id)),
    }),
  ]);

  return subs.map((s) => {
    const own = items.filter((i) => i.subscriptionId === s.id);
    return {
      ...s,
      domainUrl: provRows.find((p) => p.subscriptionId === s.id)?.domainUrl ?? null,
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      subscribedAt: s.subscribedAt.toISOString(),
      suspendedAt: s.suspendedAt?.toISOString() ?? null,
      monthlyCents: LIVE_SUBSCRIPTION_STATUSES.includes(
        s.status as (typeof LIVE_SUBSCRIPTION_STATUSES)[number],
      )
        ? own
            .filter((i) => i.status === "active")
            .reduce((sum, i) => sum + itemMrrCents(i, i.amountCents * i.quantity), 0)
        : 0,
      items: own.map((i) => ({
        id: i.id,
        kind: i.kind,
        interval: i.interval,
        intervalCount: i.intervalCount,
        name: i.name,
        amountCents: i.amountCents,
        quantity: i.quantity,
        status: i.status,
      })),
    };
  });
}

export type InvoiceDto = {
  id: string;
  invoiceNumber: string;
  status: string;
  kind: string;
  amountDueCents: number;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  createdAt: string;
  paidAt: string | null;
};

export async function listTenantInvoices(tenantId: string): Promise<InvoiceDto[]> {
  const rows = await db.query.invoices.findMany({
    where: eq(invoices.tenantId, tenantId),
    orderBy: [desc(invoices.createdAt)],
    limit: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    status: r.status,
    kind: r.kind,
    amountDueCents: r.amountDueCents,
    hostedInvoiceUrl: r.hostedInvoiceUrl,
    invoicePdfUrl: r.invoicePdfUrl,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
  }));
}

export async function getSubscriptionForTenant(subscriptionId: string, tenantId: string) {
  return db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, subscriptionId), eq(subscriptions.tenantId, tenantId)),
  });
}

/** Platform-wide MRR + live counts for the command center. */
export async function getPlatformBillingStats() {
  const liveSubs = await db.query.subscriptions.findMany({
    where: inArray(subscriptions.status, MRR_STATUSES),
    columns: { id: true, status: true },
  });
  const items = liveSubs.length
    ? await db.query.subscriptionItems.findMany({
        where: and(
          inArray(subscriptionItems.subscriptionId, liveSubs.map((s) => s.id)),
          eq(subscriptionItems.status, "active"),
        ),
      })
    : [];
  const mrrCents = items.reduce((s, i) => s + itemMrrCents(i, i.amountCents * i.quantity), 0);
  const failed = await db.query.invoices.findMany({
    where: eq(invoices.status, "failed"),
    columns: { id: true, amountDueCents: true, amountPaidCents: true },
  });
  const now = new Date();
  const open = await db.query.invoices.findMany({
    where: eq(invoices.status, "open"),
    columns: { amountDueCents: true, amountPaidCents: true, dueDate: true },
  });
  const pastDueCents =
    failed.reduce((s, i) => s + i.amountDueCents - i.amountPaidCents, 0) +
    open
      .filter((i) => i.dueDate && i.dueDate < now)
      .reduce((s, i) => s + i.amountDueCents - i.amountPaidCents, 0);
  const suspended = await db.query.subscriptions.findMany({
    where: eq(subscriptions.status, "suspended"),
    columns: { id: true },
  });
  return {
    mrrCents,
    liveSubscriptions: liveSubs.length,
    trialing: liveSubs.filter((s) => s.status === "trialing").length,
    failedInvoices: failed.length,
    pastDueCents,
    suspendedSubscriptions: suspended.length,
  };
}

// ---------------------------------------------------------------------------
// Ops → Subscriptions: every subscription across every tenant
// ---------------------------------------------------------------------------

export type OpsSubscriptionDto = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  productSlug: string;
  status: string;
  /** Configured recurring amount per month (active items, normalized), 0 unless live. */
  monthlyCents: number;
  /** One-time items (setup fees etc.) on the subscription, any settled status. */
  oneTimeCents: number;
  /** Active non-base items, e.g. "Extra location ×2". */
  addons: string[];
  currentPeriodEnd: string | null;
  subscribedAt: string;
  canceledAt: string | null;
  monthlyHostingCents: number | null;
  hostingBillingStartMonth: string | null;
};

export async function listAllSubscriptionsOps(): Promise<OpsSubscriptionDto[]> {
  const subs = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      tenantName: organization.name,
      tenantSlug: organization.slug,
      productId: subscriptions.productId,
      productName: products.name,
      productSlug: products.slug,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      subscribedAt: subscriptions.subscribedAt,
      canceledAt: subscriptions.canceledAt,
      monthlyHostingCents: subscriptions.monthlyHostingCents,
      hostingBillingStartMonth: subscriptions.hostingBillingStartMonth,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .innerJoin(organization, eq(subscriptions.tenantId, organization.id))
    .orderBy(desc(subscriptions.subscribedAt));
  if (subs.length === 0) return [];

  const items = await db
    .select({
      subscriptionId: subscriptionItems.subscriptionId,
      kind: subscriptionItems.kind,
      interval: subscriptionItems.interval,
      intervalCount: subscriptionItems.intervalCount,
      name: subscriptionItems.name,
      amountCents: subscriptionItems.amountCents,
      quantity: subscriptionItems.quantity,
      status: subscriptionItems.status,
      role: productComponents.role,
    })
    .from(subscriptionItems)
    .innerJoin(productComponents, eq(subscriptionItems.componentId, productComponents.id))
    .where(inArray(subscriptionItems.subscriptionId, subs.map((s) => s.id)));

  return subs.map((s) => {
    const own = items.filter((i) => i.subscriptionId === s.id);
    const live = LIVE_SUBSCRIPTION_STATUSES.includes(
      s.status as (typeof LIVE_SUBSCRIPTION_STATUSES)[number],
    );
    const monthlyCents = live
      ? own
          .filter((i) => i.status === "active")
          .reduce((sum, i) => sum + itemMrrCents(i, i.amountCents * i.quantity), 0)
      : 0;
    const oneTimeCents = own
      .filter((i) => !isRecurringKind(i.kind) && i.status !== "canceled")
      .reduce((sum, i) => sum + i.amountCents * i.quantity, 0);
    // Quantity is a column now; legacy multiples (duplicate rows) still add up.
    const addonCounts = new Map<string, number>();
    for (const i of own) {
      if (i.role === "base" || i.status !== "active") continue;
      addonCounts.set(i.name, (addonCounts.get(i.name) ?? 0) + i.quantity);
    }
    return {
      id: s.id,
      tenantId: s.tenantId,
      tenantName: s.tenantName,
      tenantSlug: s.tenantSlug,
      productId: s.productId,
      productName: s.productName,
      productSlug: s.productSlug,
      status: s.status,
      monthlyCents,
      oneTimeCents,
      addons: [...addonCounts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)),
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      subscribedAt: s.subscribedAt.toISOString(),
      canceledAt: s.canceledAt?.toISOString() ?? null,
      monthlyHostingCents: s.monthlyHostingCents,
      hostingBillingStartMonth: s.hostingBillingStartMonth,
    };
  });
}

// ---------------------------------------------------------------------------
// Ops → Billing: every invoice, and live Stripe collection status per subscription
// ---------------------------------------------------------------------------

export type OpsInvoiceDto = {
  id: string;
  tenantId: string;
  tenantName: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  kind: string;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  hostedInvoiceUrl: string | null;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string;
  description: string | null;
  /** Mirrored lines; catch-up months carry a period. */
  lineItems: InvoiceLineItem[];
  /** Failed, or open and past its due date — computed once here so views stay pure. */
  pastDue: boolean;
  /** Open (unresolved) dunning case, if any. */
  dunning: { id: string; remindersSent: number; suspendedAt: string | null; paused: boolean } | null;
  payments: { id: string; amountCents: number; method: string; reference: string | null; receivedAt: string }[];
};

export async function listAllInvoicesOps(
  limit = 250,
  opts: { tenantId?: string } = {},
): Promise<OpsInvoiceDto[]> {
  const rows = await db
    .select({
      id: invoices.id,
      tenantId: invoices.tenantId,
      tenantName: organization.name,
      subscriptionId: invoices.subscriptionId,
      invoiceNumber: invoices.invoiceNumber,
      kind: invoices.kind,
      status: invoices.status,
      amountDueCents: invoices.amountDueCents,
      amountPaidCents: invoices.amountPaidCents,
      hostedInvoiceUrl: invoices.hostedInvoiceUrl,
      dueDate: invoices.dueDate,
      paidAt: invoices.paidAt,
      createdAt: invoices.createdAt,
      description: invoices.description,
      lineItems: invoices.lineItems,
    })
    .from(invoices)
    .innerJoin(organization, eq(invoices.tenantId, organization.id))
    .where(opts.tenantId ? eq(invoices.tenantId, opts.tenantId) : undefined)
    .orderBy(desc(invoices.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [cases, pays] = await Promise.all([
    db.query.dunningStates.findMany({
      where: and(inArray(dunningStates.invoiceId, ids), isNull(dunningStates.resolvedAt)),
    }),
    db.query.payments.findMany({ where: inArray(payments.invoiceId, ids) }),
  ]);

  const now = new Date();
  return rows.map((r) => {
    const c = cases.find((x) => x.invoiceId === r.id);
    return {
      ...r,
      pastDue: r.status === "failed" || (r.status === "open" && r.dueDate != null && r.dueDate < now),
      dueDate: r.dueDate?.toISOString() ?? null,
      paidAt: r.paidAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      dunning: c
        ? {
            id: c.id,
            remindersSent: c.remindersSent,
            suspendedAt: c.suspendedAt?.toISOString() ?? null,
            paused: c.paused,
          }
        : null,
      payments: pays
        .filter((p) => p.invoiceId === r.id)
        .map((p) => ({
          id: p.id,
          amountCents: p.amountCents,
          method: p.method,
          reference: p.reference,
          receivedAt: p.receivedAt.toISOString(),
        })),
    };
  });
}

/** What Stripe will actually do at the next renewal — read live, never cached. */
export type SubscriptionAutomation = {
  subscriptionId: string;
  tenantId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  collectionMethod: "charge_automatically" | "send_invoice" | null;
  cardOnFile: boolean;
  /** Recurring amounts as Stripe has them, split by interval. */
  monthlyCents: number;
  yearlyCents: number;
  /** Earliest item renewal = the next invoice/charge date. */
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** Set when Stripe couldn't be read; the row falls back to local data. */
  error: string | null;
};

export async function getBillingAutomationStatus(
  opts: { tenantId?: string } = {},
): Promise<SubscriptionAutomation[]> {
  const live = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      stripeCustomerId: organization.stripeCustomerId,
    })
    .from(subscriptions)
    .innerJoin(organization, eq(subscriptions.tenantId, organization.id))
    .where(
      and(
        inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
        opts.tenantId ? eq(subscriptions.tenantId, opts.tenantId) : undefined,
      ),
    );

  const base = (s: (typeof live)[number], error: string | null): SubscriptionAutomation => ({
    subscriptionId: s.id,
    tenantId: s.tenantId,
    stripeCustomerId: s.stripeCustomerId,
    stripeSubscriptionId: s.stripeSubscriptionId,
    stripeStatus: null,
    collectionMethod: null,
    cardOnFile: false,
    monthlyCents: 0,
    yearlyCents: 0,
    nextChargeAt: s.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: false,
    error,
  });
  if (live.length === 0) return [];
  if (!stripeConfigured()) return live.map((s) => base(s, "Stripe is not configured"));

  const stripe = getStripe();
  // One customer lookup per tenant, shared across its subscriptions.
  const customerCard = new Map<string, Promise<boolean>>();
  const cardOnFile = (customerId: string) => {
    let p = customerCard.get(customerId);
    if (!p) {
      p = stripe.customers
        .retrieve(customerId)
        .then((c) => Boolean((c as Stripe.Customer).invoice_settings?.default_payment_method))
        .catch(() => false);
      customerCard.set(customerId, p);
    }
    return p;
  };

  return Promise.all(
    live.map(async (s) => {
      if (!s.stripeSubscriptionId) return base(s, "Not billed through Stripe");
      try {
        const [ss, customerHasCard] = await Promise.all([
          stripe.subscriptions.retrieve(s.stripeSubscriptionId, { expand: ["items.data.price"] }),
          s.stripeCustomerId ? cardOnFile(s.stripeCustomerId) : Promise.resolve(false),
        ]);
        let monthlyCents = 0;
        let yearlyCents = 0;
        const periodEnds: number[] = [];
        for (const it of ss.items.data) {
          const amt = (it.price.unit_amount ?? 0) * (it.quantity ?? 1);
          if (it.price.recurring?.interval === "month") monthlyCents += amt;
          else if (it.price.recurring?.interval === "year") yearlyCents += amt;
          if (it.current_period_end) periodEnds.push(it.current_period_end);
        }
        return {
          ...base(s, null),
          stripeStatus: ss.status,
          collectionMethod: ss.collection_method,
          cardOnFile: customerHasCard || Boolean(ss.default_payment_method),
          monthlyCents,
          yearlyCents,
          nextChargeAt: periodEnds.length
            ? new Date(Math.min(...periodEnds) * 1000).toISOString()
            : (s.currentPeriodEnd?.toISOString() ?? null),
          cancelAtPeriodEnd: ss.cancel_at_period_end,
        };
      } catch (e) {
        return base(s, e instanceof Error ? e.message : "Stripe lookup failed");
      }
    }),
  );
}

/** Sidebar pill: invoices that are failed, or open and past their due date. */
export async function countPastDueInvoices(now = new Date()): Promise<number> {
  const rows = await db
    .select({ status: invoices.status, dueDate: invoices.dueDate })
    .from(invoices)
    .where(inArray(invoices.status, ["open", "failed"]));
  return rows.filter((r) => r.status === "failed" || (r.dueDate != null && r.dueDate < now)).length;
}

// ---------------------------------------------------------------------------
// Ops → Client: negotiated prices per component
// ---------------------------------------------------------------------------

export type PricingRow = {
  componentId: string;
  productId: string;
  productName: string;
  componentName: string;
  listCents: number;
  intervalLabel: string;
  overrideCents: number | null;
  /** Set while the price is held for a setup link — it is released when that setup completes. */
  fromSetupLink: boolean;
};

/** Every catalog component with this client's override (if any) beside the list price. */
export async function listTenantPricingRows(tenantId: string): Promise<PricingRow[]> {
  const [allProducts, overrides] = await Promise.all([
    listAllProductsOps(),
    db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, tenantId) }),
  ]);
  return allProducts.flatMap((p) =>
    p.components.map((c) => ({
      componentId: c.id,
      productId: p.id,
      productName: p.name,
      componentName: c.name,
      listCents: c.amountCents,
      intervalLabel: intervalLabel(c),
      overrideCents: overrides.find((o) => o.componentId === c.id)?.amountCents ?? null,
      fromSetupLink: Boolean(overrides.find((o) => o.componentId === c.id)?.sourceInviteId),
    })),
  );
}

// ---------------------------------------------------------------------------
// Add-on options per live subscription, with the tenant's negotiated prices
// ---------------------------------------------------------------------------

export type AddonOption = {
  id: string;
  name: string;
  kind: string;
  interval: string | null;
  intervalCount: number;
  amountCents: number;
};

/** subscriptionId → add-ons not yet on it, priced for this tenant. */
export async function listAddonOptions(
  tenantId: string,
  subs: Pick<SubscriptionDto, "id" | "status" | "productId" | "items">[],
): Promise<Record<string, AddonOption[]>> {
  const live = subs.filter((s) => !["canceled", "expired"].includes(s.status));
  if (live.length === 0) return {};
  const [allProducts, overrides] = await Promise.all([
    listAllProductsOps(),
    db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, tenantId) }),
  ]);
  const override = new Map(overrides.map((o) => [o.componentId, o.amountCents]));
  return Object.fromEntries(
    live.map((s) => {
      const product = allProducts.find((p) => p.id === s.productId);
      const onSub = new Set(
        s.items.filter((i) => ["active", "pending"].includes(i.status)).map((i) => i.name),
      );
      return [
        s.id,
        (product?.components ?? [])
          .filter((c) => c.role !== "base" && !onSub.has(c.name))
          .map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            interval: c.interval,
            intervalCount: c.intervalCount,
            amountCents: override.get(c.id) ?? c.amountCents,
          })),
      ];
    }),
  );
}

// ---------------------------------------------------------------------------
// Ops → Client: what the "Start subscription" dialog needs
// ---------------------------------------------------------------------------

export type StartOptionComponent = {
  id: string;
  name: string;
  role: string;
  kind: string;
  interval: string | null;
  intervalCount: number;
  isRequired: boolean;
  listCents: number;
  overrideCents: number | null;
};

export type StartOptionsDto = {
  products: {
    id: string;
    name: string;
    slug: string;
    color: string | null;
    trialDays: number | null;
    /** Already live for this client — can't be started again. */
    hasLiveSubscription: boolean;
    components: StartOptionComponent[];
  }[];
  /** Live Stripe read: the customer has a default card (charge-now is possible). */
  cardOnFile: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  stripeConfigured: boolean;
};

export async function getStartSubscriptionOptions(tenantId: string): Promise<StartOptionsDto> {
  const [prods, comps, overrides, live, org, owners] = await Promise.all([
    db.query.products.findMany({ where: eq(products.isActive, true), orderBy: [asc(products.sortOrder)] }),
    db.query.productComponents.findMany({
      where: eq(productComponents.isActive, true),
      orderBy: [asc(productComponents.sortOrder)],
    }),
    db.query.tenantPriceOverrides.findMany({ where: eq(tenantPriceOverrides.tenantId, tenantId) }),
    db.query.subscriptions.findMany({
      where: and(eq(subscriptions.tenantId, tenantId), inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES)),
      columns: { productId: true },
    }),
    db.query.organization.findFirst({ where: eq(organization.id, tenantId), columns: { stripeCustomerId: true } }),
    db
      .select({ email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(and(eq(member.organizationId, tenantId), eq(member.role, "owner")))
      .limit(1),
  ]);
  const liveProductIds = new Set(live.map((s) => s.productId));
  const override = new Map(overrides.map((o) => [o.componentId, o.amountCents]));
  let cardOnFile = false;
  if (org?.stripeCustomerId && stripeConfigured()) {
    cardOnFile = await getStripe()
      .customers.retrieve(org.stripeCustomerId)
      .then((c) => Boolean((c as Stripe.Customer).invoice_settings?.default_payment_method))
      .catch(() => false);
  }
  return {
    products: prods.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      color: p.color,
      trialDays: p.trialDays,
      hasLiveSubscription: liveProductIds.has(p.id),
      components: comps
        .filter((c) => c.productId === p.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          kind: c.kind,
          interval: c.interval,
          intervalCount: c.intervalCount,
          isRequired: c.isRequired,
          listCents: c.amountCents,
          overrideCents: override.get(c.id) ?? null,
        })),
    })),
    cardOnFile,
    ownerEmail: owners[0]?.email ?? null,
    ownerName: owners[0]?.name ?? null,
    stripeConfigured: stripeConfigured(),
  };
}
