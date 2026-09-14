import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { formatCents } from "../../lib/money";
import { subscriptionItems, subscriptions } from "../billing/schema";
import { itemMrrCents, LIVE_SUBSCRIPTION_STATUSES, MRR_STATUSES } from "../billing/mappers";
import { productMetricDefinitions } from "../monitoring/schema";
import { getActiveIncidents } from "../monitoring/service";
import { currentMonth, marginByProduct } from "../costs/service";
import { isMarketingSlug } from "../webhooks_out/logic";
import { baseChargeLabel, monthlyFromCents } from "./pricing";
import { productComponents, products } from "./schema";

export type ComponentDto = {
  id: string;
  kind: string; // 'one_time' | 'recurring' | legacy kinds
  role: string; // 'base' | 'addon'
  interval: string | null;
  intervalCount: number;
  name: string;
  description: string | null;
  amountCents: number;
  isRequired: boolean;
};

export type ProductDto = {
  id: string;
  slug: string;
  name: string;
  category: string;
  tagline: string | null;
  description: string;
  features: string[];
  color: string | null;
  components: ComponentDto[];
};

function toComponentDto(c: typeof productComponents.$inferSelect): ComponentDto {
  return {
    id: c.id,
    kind: c.kind,
    role: c.role,
    interval: c.interval,
    intervalCount: c.intervalCount,
    name: c.name,
    description: c.description,
    amountCents: c.amountCents,
    isRequired: c.isRequired,
  };
}

export async function listActiveProducts(): Promise<ProductDto[]> {
  const rows = await db.query.products.findMany({
    where: eq(products.isActive, true),
    orderBy: [asc(products.sortOrder)],
  });
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.isActive, true),
    orderBy: [asc(productComponents.sortOrder)],
  });
  return rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    tagline: p.tagline,
    description: p.description,
    features: p.features,
    color: p.color,
    components: comps.filter((c) => c.productId === p.id).map(toComponentDto),
  }));
}

/** Ops view: every product, hidden ones included, flagged. */
export async function listAllProductsOps(): Promise<(ProductDto & { isActive: boolean })[]> {
  const rows = await db.query.products.findMany({ orderBy: [asc(products.sortOrder)] });
  const comps = await db.query.productComponents.findMany({
    orderBy: [asc(productComponents.sortOrder)],
  });
  return rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    tagline: p.tagline,
    description: p.description,
    features: p.features,
    color: p.color,
    isActive: p.isActive,
    components: comps.filter((c) => c.productId === p.id && c.isActive).map(toComponentDto),
  }));
}

export async function getProductBySlug(slug: string): Promise<ProductDto | null> {
  const p = await db.query.products.findFirst({
    where: eq(products.slug, slug),
  });
  if (!p || !p.isActive) return null;
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, p.id),
    orderBy: [asc(productComponents.sortOrder)],
  });
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    tagline: p.tagline,
    description: p.description,
    features: p.features,
    color: p.color,
    components: comps.filter((c) => c.isActive).map(toComponentDto),
  };
}

// ---------------------------------------------------------------------------
// Ops → Product editor
// ---------------------------------------------------------------------------

export type ProductEditorDto = {
  id: string;
  slug: string;
  name: string;
  category: string;
  tagline: string | null;
  description: string;
  features: string[];
  color: string | null;
  trialDays: number | null;
  isActive: boolean;
};

export type ComponentEditorDto = {
  id: string;
  kind: string;
  role: string;
  interval: string | null;
  intervalCount: number;
  name: string;
  description: string | null;
  amountCents: number;
  isRequired: boolean;
  isActive: boolean;
  /** A Stripe Price exists; otherwise it is minted at the next checkout. */
  synced: boolean;
};

/** One product with every component (hidden ones included) for the ops editor. */
export async function getProductForEditor(
  id: string,
): Promise<{ product: ProductEditorDto; components: ComponentEditorDto[] } | null> {
  const p = await db.query.products.findFirst({ where: eq(products.id, id) });
  if (!p) return null;
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, id),
    orderBy: [asc(productComponents.sortOrder)],
  });
  return {
    product: {
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category,
      tagline: p.tagline,
      description: p.description,
      features: p.features,
      color: p.color,
      trialDays: p.trialDays,
      isActive: p.isActive,
    },
    components: comps.map((c) => ({
      id: c.id,
      kind: c.kind,
      role: c.role,
      interval: c.interval,
      intervalCount: c.intervalCount,
      name: c.name,
      description: c.description,
      amountCents: c.amountCents,
      isRequired: c.isRequired,
      isActive: c.isActive,
      synced: Boolean(c.stripePriceId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Ops → Products board + product page
// ---------------------------------------------------------------------------

export type ProductBoardRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  color: string | null;
  isActive: boolean;
  isMarketing: boolean;
  sortOrder: number;
  /** "$79.00/mo" style headline from the base charge. */
  baseCharge: string | null;
  monthlyFromCents: number;
  componentsActive: number;
  componentsTotal: number;
  kpiCount: number;
  liveSubscribers: number;
  mrrCents: number;
  openIncidents: number;
  marginPct: number | null;
  costMtdCents: number | null;
  revenueMtdCents: number;
};

export async function listProductsBoardOps(): Promise<ProductBoardRow[]> {
  const [rows, comps, defs, subs, incidents, margins] = await Promise.all([
    db.query.products.findMany({ orderBy: [asc(products.sortOrder), asc(products.name)] }),
    db.query.productComponents.findMany({ orderBy: [asc(productComponents.sortOrder)] }),
    db.query.productMetricDefinitions.findMany({ columns: { productId: true } }),
    db.query.subscriptions.findMany({
      where: inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
      columns: { id: true, productId: true, status: true },
    }),
    getActiveIncidents(),
    marginByProduct(currentMonth()).catch(() => [] as Awaited<ReturnType<typeof marginByProduct>>),
  ]);
  const liveIds = subs.map((s) => s.id);
  const items = liveIds.length
    ? await db.query.subscriptionItems.findMany({
        where: and(inArray(subscriptionItems.subscriptionId, liveIds), eq(subscriptionItems.status, "active")),
      })
    : [];
  const subProduct = new Map(subs.map((s) => [s.id, s.productId]));
  const mrrByProduct = new Map<string, number>();
  const mrrStatuses = new Set<string>(MRR_STATUSES);
  const subStatus = new Map(subs.map((s) => [s.id, s.status]));
  for (const i of items) {
    if (!mrrStatuses.has(subStatus.get(i.subscriptionId) ?? "")) continue;
    const pid = subProduct.get(i.subscriptionId);
    if (!pid) continue;
    mrrByProduct.set(pid, (mrrByProduct.get(pid) ?? 0) + itemMrrCents(i, i.amountCents));
  }

  return rows.map((p) => {
    const mine = comps.filter((c) => c.productId === p.id);
    const active = mine.filter((c) => c.isActive);
    const margin = margins.find((m) => m.productId === p.id);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category,
      color: p.color,
      isActive: p.isActive,
      isMarketing: isMarketingSlug(p.slug),
      sortOrder: p.sortOrder,
      baseCharge: baseChargeLabel(active, formatCents),
      monthlyFromCents: monthlyFromCents(active),
      componentsActive: active.length,
      componentsTotal: mine.length,
      kpiCount: defs.filter((d) => d.productId === p.id).length,
      liveSubscribers: subs.filter((s) => s.productId === p.id).length,
      mrrCents: mrrByProduct.get(p.id) ?? 0,
      openIncidents: incidents.filter((i) => i.productId === p.id).length,
      marginPct: margin?.marginPct ?? null,
      costMtdCents: margin?.costCents ?? null,
      revenueMtdCents: margin?.revenueCents ?? 0,
    };
  });
}

export type ProductOps = {
  product: ProductEditorDto & {
    icon: string | null;
    sortOrder: number;
    reporterQuietAfterMinutes: number | null;
    isMarketing: boolean;
    defaultExpectedCname: string | null;
    defaultExpectedAIps: string | null;
    defaultMonthlyHostingCents: number | null;
    createdAt: string;
  };
  components: ComponentEditorDto[];
  metricDefinitions: MetricDefinitionDto[];
  liveSubscribers: number;
  mrrCents: number;
};

export type MetricDefinitionDto = {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  valueType: string;
  aggregation: string;
  direction: string;
  target: number | null;
  isPrimary: boolean;
  displayOrder: number;
};

/** Everything the tabbed product page needs, in one read. */
export async function getProductOps(id: string): Promise<ProductOps | null> {
  const editor = await getProductForEditor(id);
  if (!editor) return null;
  const [p, defs, subs] = await Promise.all([
    db.query.products.findFirst({ where: eq(products.id, id) }),
    db.query.productMetricDefinitions.findMany({
      where: eq(productMetricDefinitions.productId, id),
      orderBy: [asc(productMetricDefinitions.displayOrder)],
    }),
    db.query.subscriptions.findMany({
      where: and(eq(subscriptions.productId, id), inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES)),
      columns: { id: true, status: true },
    }),
  ]);
  if (!p) return null;
  const liveIds = subs.filter((s) => (MRR_STATUSES as string[]).includes(s.status)).map((s) => s.id);
  const items = liveIds.length
    ? await db.query.subscriptionItems.findMany({
        where: and(inArray(subscriptionItems.subscriptionId, liveIds), eq(subscriptionItems.status, "active")),
      })
    : [];
  return {
    product: {
      ...editor.product,
      icon: p.icon,
      sortOrder: p.sortOrder,
      reporterQuietAfterMinutes: p.reporterQuietAfterMinutes,
      isMarketing: isMarketingSlug(p.slug),
      defaultExpectedCname: p.defaultExpectedCname,
      defaultExpectedAIps: p.defaultExpectedAIps,
      defaultMonthlyHostingCents: p.defaultMonthlyHostingCents,
      createdAt: p.createdAt.toISOString(),
    },
    components: editor.components,
    metricDefinitions: defs.map((d) => ({
      id: d.id,
      key: d.key,
      label: d.label,
      unit: d.unit,
      valueType: d.valueType,
      aggregation: d.aggregation,
      direction: d.direction,
      target: d.target,
      isPrimary: d.isPrimary,
      displayOrder: d.displayOrder,
    })),
    liveSubscribers: subs.length,
    mrrCents: items.reduce((s, i) => s + itemMrrCents(i, i.amountCents), 0),
  };
}
