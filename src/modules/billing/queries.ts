import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { organization } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { invoices, subscriptionItems, subscriptions } from "./schema";
import { isRecurringKind, itemMrrCents, LIVE_SUBSCRIPTION_STATUSES, MRR_STATUSES } from "./mappers";

export type SubscriptionItemDto = {
  id: string;
  kind: string;
  interval: string | null;
  intervalCount: number;
  name: string;
  amountCents: number;
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
      monthlyCents: LIVE_SUBSCRIPTION_STATUSES.includes(
        s.status as (typeof LIVE_SUBSCRIPTION_STATUSES)[number],
      )
        ? own
            .filter((i) => i.status === "active")
            .reduce((sum, i) => sum + itemMrrCents(i, i.amountCents), 0)
        : 0,
      items: own.map((i) => ({
        id: i.id,
        kind: i.kind,
        interval: i.interval,
        intervalCount: i.intervalCount,
        name: i.name,
        amountCents: i.amountCents,
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
  const mrrCents = items.reduce((s, i) => s + itemMrrCents(i, i.amountCents), 0);
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
};

export async function listAllSubscriptionsOps(): Promise<OpsSubscriptionDto[]> {
  const subs = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      tenantName: organization.name,
      tenantSlug: organization.slug,
      productName: products.name,
      productSlug: products.slug,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      subscribedAt: subscriptions.subscribedAt,
      canceledAt: subscriptions.canceledAt,
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
          .reduce((sum, i) => sum + itemMrrCents(i, i.amountCents), 0)
      : 0;
    const oneTimeCents = own
      .filter((i) => !isRecurringKind(i.kind) && i.status !== "canceled")
      .reduce((sum, i) => sum + i.amountCents, 0);
    const addonCounts = new Map<string, number>();
    for (const i of own) {
      if (i.role === "base" || i.status !== "active") continue;
      addonCounts.set(i.name, (addonCounts.get(i.name) ?? 0) + 1);
    }
    return {
      id: s.id,
      tenantId: s.tenantId,
      tenantName: s.tenantName,
      tenantSlug: s.tenantSlug,
      productName: s.productName,
      productSlug: s.productSlug,
      status: s.status,
      monthlyCents,
      oneTimeCents,
      addons: [...addonCounts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)),
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      subscribedAt: s.subscribedAt.toISOString(),
      canceledAt: s.canceledAt?.toISOString() ?? null,
    };
  });
}
