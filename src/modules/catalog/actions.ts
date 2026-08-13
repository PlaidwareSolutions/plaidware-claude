"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { productComponents, products } from "./schema";

type ActionResult = { ok: true } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
}

const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(80),
  category: z.string().min(2).max(60),
  tagline: z.string().max(140).optional(),
  description: z.string().min(10).max(2000),
  features: z.array(z.string().min(1).max(120)).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  trialDays: z.number().int().min(0).max(90).nullable(),
  isActive: z.boolean(),
});

export async function updateProductAction(
  input: z.infer<typeof productSchema>,
): Promise<ActionResult> {
  try {
    await requireOps();
    const p = productSchema.parse(input);
    await db
      .update(products)
      .set({
        name: p.name,
        category: p.category,
        tagline: p.tagline ?? null,
        description: p.description,
        features: p.features,
        color: p.color ?? null,
        trialDays: p.trialDays === 0 ? null : p.trialDays,
        isActive: p.isActive,
      })
      .where(eq(products.id, p.id));
    revalidatePath("/ops/products");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const componentSchema = z.object({
  id: z.string().uuid().optional(), // absent = create
  productId: z.string().uuid(),
  kind: z.enum(["one_time", "recurring_monthly", "recurring_yearly"]),
  name: z.string().min(2).max(80),
  description: z.string().max(200).optional(),
  amountCents: z.number().int().min(0).max(100_000_000),
  isRequired: z.boolean(),
  isActive: z.boolean(),
});

export async function upsertComponentAction(
  input: z.infer<typeof componentSchema>,
): Promise<ActionResult> {
  try {
    await requireOps();
    const c = componentSchema.parse(input);
    if (c.id) {
      const existing = await db.query.productComponents.findFirst({
        where: eq(productComponents.id, c.id),
      });
      if (!existing) throw new Error("Component not found");
      const priceChanged =
        existing.amountCents !== c.amountCents || existing.kind !== c.kind;
      await db
        .update(productComponents)
        .set({
          kind: c.kind,
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
      await db.insert(productComponents).values({
        productId: c.productId,
        kind: c.kind,
        name: c.name,
        description: c.description ?? null,
        amountCents: c.amountCents,
        isRequired: c.isRequired,
        isActive: c.isActive,
        sortOrder: 99,
      });
    }
    revalidatePath("/ops/products");
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
