"use server";

import { revalidatePath } from "next/cache";
import { OPS, TENANT } from "@/lib/routes";
import { revalidateClientViews } from "@/lib/ops-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireMembership, requireOps } from "../../policy";
import { getSubscriptionForTenant } from "../billing/queries";
import { METRIC_DEFS } from "../catalog/seed";
import { metricDefinitionSchema, type MetricDefinitionInput } from "./contracts";
import { productMetricDefinitions } from "./schema";
import { acknowledgeIncident, mintIngestKey } from "./service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong",
});

function revalidateProductKpis(productId: string) {
  revalidatePath(OPS.productTab(productId, "kpis"));
  revalidatePath(OPS.products);
  revalidatePath(TENANT.monitoring);
  revalidateClientViews();
}

/** Create or update one KPI definition; `isPrimary` is exclusive per product. */
export async function upsertMetricDefinitionAction(input: MetricDefinitionInput): Promise<ActionResult> {
  try {
    await requireOps();
    const d = metricDefinitionSchema.parse(input);
    await db.transaction(async (tx) => {
      const clash = await tx.query.productMetricDefinitions.findFirst({
        where: and(eq(productMetricDefinitions.productId, d.productId), eq(productMetricDefinitions.key, d.key)),
      });
      if (clash && clash.id !== d.id) throw new Error(`"${d.key}" is already defined for this product`);
      if (d.isPrimary) {
        await tx
          .update(productMetricDefinitions)
          .set({ isPrimary: false })
          .where(eq(productMetricDefinitions.productId, d.productId));
      }
      const values = {
        key: d.key,
        label: d.label,
        unit: d.unit?.trim() || null,
        valueType: d.valueType,
        aggregation: d.aggregation,
        direction: d.direction,
        target: d.target ?? null,
        isPrimary: d.isPrimary,
      };
      if (d.id) {
        await tx.update(productMetricDefinitions).set(values).where(eq(productMetricDefinitions.id, d.id));
      } else {
        const siblings = await tx.query.productMetricDefinitions.findMany({
          where: eq(productMetricDefinitions.productId, d.productId),
          columns: { displayOrder: true },
        });
        await tx.insert(productMetricDefinitions).values({
          productId: d.productId,
          ...values,
          displayOrder: siblings.length ? Math.max(...siblings.map((s) => s.displayOrder)) + 1 : 0,
        });
      }
    });
    revalidateProductKpis(d.productId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteMetricDefinitionAction(productId: string, id: string): Promise<ActionResult> {
  try {
    await requireOps();
    await db
      .delete(productMetricDefinitions)
      .where(and(eq(productMetricDefinitions.id, id), eq(productMetricDefinitions.productId, productId)));
    revalidateProductKpis(productId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reorderMetricDefinitionsAction(productId: string, orderedIds: string[]): Promise<ActionResult> {
  try {
    await requireOps();
    z.array(z.string().uuid()).min(1).max(50).parse(orderedIds);
    await db.transaction(async (tx) => {
      for (const [i, id] of orderedIds.entries()) {
        await tx
          .update(productMetricDefinitions)
          .set({ displayOrder: i })
          .where(and(eq(productMetricDefinitions.id, id), eq(productMetricDefinitions.productId, productId)));
      }
    });
    revalidateProductKpis(productId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Seed a product's KPIs from one of the starter templates; existing keys are kept. */
export async function applyMetricTemplateAction(
  productId: string,
  templateSlug: string,
): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  try {
    await requireOps();
    const template = METRIC_DEFS[templateSlug];
    if (!template) throw new Error("Unknown template");
    const existing = await db.query.productMetricDefinitions.findMany({
      where: eq(productMetricDefinitions.productId, productId),
    });
    const have = new Set(existing.map((e) => e.key));
    let order = existing.length ? Math.max(...existing.map((e) => e.displayOrder)) + 1 : 0;
    let added = 0;
    for (const d of template) {
      if (have.has(d.key)) continue;
      await db.insert(productMetricDefinitions).values({
        productId,
        key: d.key,
        label: d.label,
        unit: d.unit ?? null,
        valueType: d.valueType ?? "count",
        aggregation: d.aggregation ?? "sum",
        direction: d.direction ?? "up_is_good",
        isPrimary: existing.length === 0 && added === 0 ? Boolean(d.isPrimary) : false,
        displayOrder: order++,
      });
      added++;
    }
    revalidateProductKpis(productId);
    return { ok: true, added };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Template failed" };
  }
}

export async function rotateIngestKeyAction(
  tenantId: string,
  subscriptionId: string,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  try {
    await requireMembership(tenantId, "write");
    const sub = await getSubscriptionForTenant(subscriptionId, tenantId);
    if (!sub) throw new Error("Subscription not found");
    const key = await mintIngestKey(subscriptionId);
    revalidatePath(TENANT.monitoring);
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rotation failed" };
  }
}

export async function ackIncidentAction(
  healthCheckId: string,
  subscriptionId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireOps();
    await acknowledgeIncident(healthCheckId, subscriptionId, session.user.id, note);
    revalidatePath(OPS.monitoring);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ack failed" };
  }
}
