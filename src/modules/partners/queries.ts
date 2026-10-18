import { asc, count, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { subscriptionItems, subscriptions } from "../billing/schema";
import { productComponents, products } from "../catalog/schema";
import { partnerApps, partnerKeys, partnerTenantLinks } from "./schema";

/** Contract §D: the subscription webhook payload fields plus updated_at. */
export type PartnerSubscriptionDto = {
  hub_subscription_id: string;
  hub_org_id: string;
  product_slug: string;
  status: string;
  current_period_end: string | null;
  addon_components: { name: string; quantity: number }[];
  updated_at: string;
};

/**
 * Read-only reconciliation feed for partner systems. All statuses are
 * included (canceled/expired too) so the partner can converge from any
 * missed webhook. `productPrefix` must be pre-validated by the caller —
 * it is interpolated into a LIKE pattern.
 */
export async function listPartnerSubscriptions(
  productPrefix: string,
  opts: { limit: number; offset: number },
): Promise<{ subscriptions: PartnerSubscriptionDto[]; hasMore: boolean }> {
  const rows = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      updatedAt: subscriptions.updatedAt,
      slug: products.slug,
    })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(like(products.slug, `${productPrefix}%`))
    .orderBy(asc(subscriptions.createdAt), asc(subscriptions.id))
    .limit(opts.limit + 1)
    .offset(opts.offset);

  const page = rows.slice(0, opts.limit);
  const ids = page.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({
          subscriptionId: subscriptionItems.subscriptionId,
          name: subscriptionItems.name,
          status: subscriptionItems.status,
          quantity: subscriptionItems.quantity,
          role: productComponents.role,
        })
        .from(subscriptionItems)
        .innerJoin(productComponents, eq(subscriptionItems.componentId, productComponents.id))
        .where(inArray(subscriptionItems.subscriptionId, ids))
    : [];

  // quantity = sum of item quantities per name (legacy duplicate rows still add up)
  const addonsBySub = new Map<string, Map<string, number>>();
  for (const it of items) {
    if (it.role === "base" || it.status === "canceled") continue;
    const bucket = addonsBySub.get(it.subscriptionId) ?? new Map<string, number>();
    bucket.set(it.name, (bucket.get(it.name) ?? 0) + it.quantity);
    addonsBySub.set(it.subscriptionId, bucket);
  }

  return {
    subscriptions: page.map((r) => ({
      hub_subscription_id: r.id,
      hub_org_id: r.tenantId,
      product_slug: r.slug,
      status: r.status,
      current_period_end: r.currentPeriodEnd?.toISOString() ?? null,
      addon_components: [...(addonsBySub.get(r.id) ?? new Map<string, number>())].map(
        ([name, quantity]) => ({ name, quantity }),
      ),
      updated_at: r.updatedAt.toISOString(),
    })),
    hasMore: rows.length > opts.limit,
  };
}

// ---------------------------------------------------------------------------
// Ops → System → Partners, and the client provisioning tab's link card
// ---------------------------------------------------------------------------

export type PartnerAppOpsDto = {
  id: string;
  name: string;
  displayName: string;
  productPrefixes: string[];
  webhookUrl: string | null;
  provisionUrl: string | null;
  billingUrl: string | null;
  allowedReturnOrigins: string[];
  hasSecret: boolean;
  status: "active" | "disabled";
  linkedClients: number;
  keys: { id: string; name: string; prefix: string; createdAt: string; revokedAt: string | null }[];
};

export async function listPartnerAppsOps(): Promise<PartnerAppOpsDto[]> {
  const [apps, keys, links] = await Promise.all([
    db.query.partnerApps.findMany({ orderBy: [asc(partnerApps.displayName)] }),
    db.query.partnerKeys.findMany({ orderBy: [desc(partnerKeys.createdAt)] }),
    db.select({ appId: partnerTenantLinks.partnerAppId, n: count() }).from(partnerTenantLinks).groupBy(partnerTenantLinks.partnerAppId),
  ]);
  return apps.map((a) => ({
    id: a.id,
    name: a.name,
    displayName: a.displayName,
    productPrefixes: a.productPrefixes,
    webhookUrl: a.webhookUrl,
    provisionUrl: a.provisionUrl,
    billingUrl: a.billingUrl,
    allowedReturnOrigins: a.allowedReturnOrigins,
    hasSecret: Boolean(a.webhookSecretEnc),
    status: a.status,
    linkedClients: links.find((l) => l.appId === a.id)?.n ?? 0,
    keys: keys
      .filter((k) => k.partnerAppId === a.id)
      .map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        createdAt: k.createdAt.toISOString(),
        revokedAt: k.revokedAt?.toISOString() ?? null,
      })),
  }));
}

export type TenantPartnerLinkDto = {
  appId: string;
  displayName: string;
  status: "active" | "disabled";
  externalTenantId: string | null;
  linkedBy: string | null;
  linkedAt: string | null;
};

/** One row per partner app: this client's link (or none). */
export async function listTenantPartnerLinks(tenantId: string): Promise<TenantPartnerLinkDto[]> {
  const [apps, links] = await Promise.all([
    db.query.partnerApps.findMany({ orderBy: [asc(partnerApps.displayName)] }),
    db.query.partnerTenantLinks.findMany({ where: eq(partnerTenantLinks.tenantId, tenantId) }),
  ]);
  return apps.map((a) => {
    const l = links.find((x) => x.partnerAppId === a.id);
    return {
      appId: a.id,
      displayName: a.displayName,
      status: a.status,
      externalTenantId: l?.externalTenantId ?? null,
      linkedBy: l ? (l.linkedBy.startsWith("ops:") ? "ops" : l.linkedBy) : null,
      linkedAt: l?.createdAt.toISOString() ?? null,
    };
  });
}
