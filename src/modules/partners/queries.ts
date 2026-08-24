import { asc, eq, inArray, like } from "drizzle-orm";
import { db } from "../../db";
import { subscriptionItems, subscriptions } from "../billing/schema";
import { productComponents, products } from "../catalog/schema";

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
          role: productComponents.role,
        })
        .from(subscriptionItems)
        .innerJoin(productComponents, eq(subscriptionItems.componentId, productComponents.id))
        .where(inArray(subscriptionItems.subscriptionId, ids))
    : [];

  const addonsBySub = new Map<string, Map<string, number>>();
  for (const it of items) {
    if (it.role === "base" || it.status === "canceled") continue;
    const bucket = addonsBySub.get(it.subscriptionId) ?? new Map<string, number>();
    bucket.set(it.name, (bucket.get(it.name) ?? 0) + 1);
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
