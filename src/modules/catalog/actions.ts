"use server";

import { revalidatePath } from "next/cache";
import { MARKETING, OPS } from "@/lib/routes";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { isMarketingSlug } from "../webhooks_out/logic";
import { isProductIcon } from "./icons";
import { productComponents, products } from "./schema";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
}

const createProductSchema = z.object({
  name: z.string().min(2).max(80),
  category: z.string().min(2).max(60),
  tagline: z.string().max(140).optional(),
  description: z.string().min(10).max(2000),
});

/** New catalog product (billing v2 addendum); lands hidden until components exist. */
export async function createProductAction(
  input: z.infer<typeof createProductSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireOps();
    const p = createProductSchema.parse(input);
    const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "product";
    let slug = base;
    for (let i = 2; ; i++) {
      const hit = await db.query.products.findFirst({ where: eq(products.slug, slug), columns: { id: true } });
      if (!hit) break;
      slug = `${base}-${i}`;
    }
    const [row] = await db
      .insert(products)
      .values({
        slug,
        name: p.name,
        category: p.category,
        tagline: p.tagline ?? null,
        description: p.description,
        features: [],
        isActive: false, // hidden until priced and reviewed
        sortOrder: 99,
      })
      .returning({ id: products.id });
    revalidatePath(OPS.products);
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Create failed" };
  }
}

const productSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slugs are lowercase words joined by hyphens").max(60),
  name: z.string().min(2).max(80),
  category: z.string().min(2).max(60),
  tagline: z.string().max(140).optional(),
  description: z.string().min(10).max(2000),
  features: z.array(z.string().min(1).max(120)).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(40).nullable().optional(),
  trialDays: z.number().int().min(0).max(90).nullable(),
  reporterQuietAfterMinutes: z.number().int().min(5).max(20160).nullable(),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
});

function revalidateProduct(id: string) {
  revalidatePath(OPS.products);
  revalidatePath(OPS.product(id), "layout");
  revalidatePath(MARKETING.products);
  revalidatePath("/");
}

export async function updateProductAction(
  input: z.infer<typeof productSchema>,
): Promise<ActionResult> {
  try {
    await requireOps();
    const p = productSchema.parse(input);
    const current = await db.query.products.findFirst({ where: eq(products.id, p.id) });
    if (!current) throw new Error("Product not found");
    if (p.slug !== current.slug) {
      // marketing-* is the MHub contract: partner feed scope, lifecycle webhooks, handshake.
      if (isMarketingSlug(current.slug) || isMarketingSlug(p.slug)) {
        throw new Error("marketing-* slugs are part of the MHub contract and can't be renamed here");
      }
      const taken = await db.query.products.findFirst({ where: eq(products.slug, p.slug), columns: { id: true } });
      if (taken) throw new Error(`The slug "${p.slug}" is already used by another product`);
    }
    if (p.icon && !isProductIcon(p.icon)) throw new Error("Pick an icon from the list");
    await db
      .update(products)
      .set({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tagline: p.tagline ?? null,
        description: p.description,
        features: p.features,
        color: p.color ?? null,
        icon: p.icon ?? null,
        trialDays: p.trialDays === 0 ? null : p.trialDays,
        reporterQuietAfterMinutes: p.reporterQuietAfterMinutes,
        sortOrder: p.sortOrder,
        isActive: p.isActive,
      })
      .where(eq(products.id, p.id));
    revalidateProduct(p.id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const defaultsSchema = z.object({
  id: z.string().uuid(),
  defaultExpectedCname: z.string().max(200).nullable(),
  defaultExpectedAIps: z.string().max(300).nullable(),
  defaultMonthlyHostingCents: z.number().int().min(0).max(100_000_000).nullable(),
});

/** Provisioning defaults for new subscriptions of this product (existing rows untouched). */
export async function updateProductDefaultsAction(
  input: z.infer<typeof defaultsSchema>,
): Promise<ActionResult> {
  try {
    await requireOps();
    const p = defaultsSchema.parse(input);
    await db
      .update(products)
      .set({
        defaultExpectedCname: p.defaultExpectedCname?.trim() || null,
        defaultExpectedAIps: p.defaultExpectedAIps?.trim() || null,
        defaultMonthlyHostingCents: p.defaultMonthlyHostingCents || null,
      })
      .where(eq(products.id, p.id));
    revalidateProduct(p.id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Make one component the product's main charge; every other one becomes an add-on. */
export async function setBaseComponentAction(productId: string, componentId: string): Promise<ActionResult> {
  try {
    await requireOps();
    z.string().uuid().parse(productId);
    z.string().uuid().parse(componentId);
    await db.transaction(async (tx) => {
      const target = await tx.query.productComponents.findFirst({
        where: and(eq(productComponents.id, componentId), eq(productComponents.productId, productId)),
      });
      if (!target) throw new Error("Component not found");
      await tx
        .update(productComponents)
        .set({ role: "addon" })
        .where(and(eq(productComponents.productId, productId), eq(productComponents.role, "base")));
      await tx.update(productComponents).set({ role: "base", isRequired: true }).where(eq(productComponents.id, componentId));
    });
    revalidateProduct(productId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Persist a new display order for the product's components. */
export async function reorderComponentsAction(productId: string, orderedIds: string[]): Promise<ActionResult> {
  try {
    await requireOps();
    z.string().uuid().parse(productId);
    z.array(z.string().uuid()).min(1).max(50).parse(orderedIds);
    await db.transaction(async (tx) => {
      for (const [i, id] of orderedIds.entries()) {
        await tx
          .update(productComponents)
          .set({ sortOrder: i })
          .where(and(eq(productComponents.id, id), eq(productComponents.productId, productId)));
      }
    });
    revalidateProduct(productId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const componentSchema = z
  .object({
    id: z.string().uuid().optional(), // absent = create
    productId: z.string().uuid(),
    kind: z.enum(["one_time", "recurring"]),
    interval: z.enum(["week", "month", "year"]).optional(),
    intervalCount: z.number().int().min(1).max(36).default(1),
    role: z.enum(["base", "addon"]).default("addon"),
    name: z.string().min(2).max(80),
    description: z.string().max(200).optional(),
    amountCents: z.number().int().min(0).max(100_000_000),
    isRequired: z.boolean(),
    isActive: z.boolean(),
  })
  .refine((v) => v.kind !== "recurring" || v.interval != null, {
    message: "Recurring components need a billing interval",
  });

export async function upsertComponentAction(
  input: z.infer<typeof componentSchema>,
): Promise<ActionResult> {
  try {
    await requireOps();
    const c = componentSchema.parse(input);
    const interval = c.kind === "recurring" ? c.interval! : null;
    const intervalCount = c.kind === "recurring" ? c.intervalCount : 1;

    // One main charge per product (billing v2) — friendly error before the
    // partial unique index would reject it.
    if (c.role === "base") {
      const existingBase = await db.query.productComponents.findFirst({
        where: and(eq(productComponents.productId, c.productId), eq(productComponents.role, "base")),
      });
      if (existingBase && existingBase.id !== c.id) {
        throw new Error(
          `"${existingBase.name}" is already this product's main charge. Change it to an add-on first.`,
        );
      }
    }

    if (c.id) {
      const existing = await db.query.productComponents.findFirst({
        where: eq(productComponents.id, c.id),
      });
      if (!existing) throw new Error("Component not found");
      const priceChanged =
        existing.amountCents !== c.amountCents ||
        existing.kind !== c.kind ||
        existing.interval !== interval ||
        existing.intervalCount !== intervalCount;
      await db
        .update(productComponents)
        .set({
          kind: c.kind,
          interval,
          intervalCount,
          role: c.role,
          name: c.name,
          description: c.description ?? null,
          amountCents: c.amountCents,
          isRequired: c.isRequired,
          isActive: c.isActive,
          // Stripe prices are immutable — a change clears the reference and
          // the next checkout mints a fresh Price. Existing subscriptions
          // keep their snapshotted prices (PRD §3).
          ...(priceChanged ? { stripePriceId: null } : {}),
        })
        .where(eq(productComponents.id, c.id));
    } else {
      const siblings = await db.query.productComponents.findMany({
        where: eq(productComponents.productId, c.productId),
        columns: { sortOrder: true },
      });
      await db.insert(productComponents).values({
        productId: c.productId,
        kind: c.kind,
        interval,
        intervalCount,
        role: c.role,
        name: c.name,
        description: c.description ?? null,
        amountCents: c.amountCents,
        isRequired: c.isRequired,
        isActive: c.isActive,
        sortOrder: siblings.length ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0,
      });
    }
    revalidateProduct(c.productId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
