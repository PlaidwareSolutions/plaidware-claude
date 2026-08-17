import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
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
