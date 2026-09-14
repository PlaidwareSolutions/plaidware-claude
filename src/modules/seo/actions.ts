"use server";

import { revalidatePath } from "next/cache";
import { OPS, TENANT } from "@/lib/routes";
import { revalidateClientViews } from "@/lib/ops-revalidate";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { subscriptions } from "../billing/schema";
import { products } from "../catalog/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { seoSnoozes } from "./schema";
import { auditOneSubscription, lastAuditAt, seoPanelData } from "./service";
import { categorySeverity, CATEGORIES } from "./pagespeed";
import { recheckAllowed } from "./recheck";

function revalidateSeo() {
  revalidatePath(TENANT.monitoring);
  revalidatePath(OPS.monitoring);
  revalidateClientViews();
}

/** Only Company Website subscriptions are audited; the snooze/recheck actions refuse anything else. */
async function assertSeoSubscription(subscriptionId: string) {
  const [row] = await db
    .select({ tenantId: subscriptions.tenantId, slug: products.slug })
    .from(subscriptions)
    .innerJoin(products, eq(subscriptions.productId, products.id))
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  if (!row) throw new Error("Subscription not found");
  if (row.slug !== "company-website") throw new Error("SEO audits only run for Company Website subscriptions");
  return row;
}

export async function runSeoRecheckAction(
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOps();
    await assertSeoSubscription(subscriptionId);
    // Cooldown derives from the last stored audit, so it holds across instances and restarts.
    const gate = recheckAllowed(await lastAuditAt(subscriptionId));
    if (!gate.allowed) {
      return { ok: false, error: `Recheck is rate-limited — try again in ${gate.retryInSeconds}s` };
    }
    const prov = await db.query.subscriptionProvisioning.findFirst({
      where: eq(subscriptionProvisioning.subscriptionId, subscriptionId),
    });
    if (!prov?.domainUrl) throw new Error("Set a live domain first");
    await auditOneSubscription(subscriptionId, prov.domainUrl);
    revalidateSeo();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Recheck failed" };
  }
}

export async function clearSeoSnoozeAction(
  subscriptionId: string,
  strategy: "mobile" | "desktop",
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOps();
    const { tenantId } = await assertSeoSubscription(subscriptionId);
    await db.delete(seoSnoozes).where(and(eq(seoSnoozes.tenantId, tenantId), eq(seoSnoozes.strategy, strategy)));
    revalidateSeo();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not clear the snooze" };
  }
}

export async function snoozeSeoAction(
  subscriptionId: string,
  strategy: "mobile" | "desktop",
  days: 1 | 3 | 7,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireOps();
    const sub = await assertSeoSubscription(subscriptionId);
    // Capture the current worst severity so a sharper drop breaks through.
    const panels = await seoPanelData(subscriptionId);
    const panel = panels.find((p) => p.strategy === strategy);
    const worst = panel
      ? Math.max(
          0,
          ...CATEGORIES.map((c) =>
            panel.latest[c] != null ? categorySeverity(panel.latest[c]!, null) : 0,
          ),
        )
      : 0;
    await db
      .insert(seoSnoozes)
      .values({
        tenantId: sub.tenantId,
        strategy,
        snoozedUntil: new Date(Date.now() + days * 86_400_000),
        severityAtSnooze: worst,
        snoozedByUserId: session.user.id,
      })
      .onConflictDoUpdate({
        target: [seoSnoozes.tenantId, seoSnoozes.strategy],
        set: {
          snoozedUntil: new Date(Date.now() + days * 86_400_000),
          severityAtSnooze: worst,
          snoozedByUserId: session.user.id,
        },
      });
    revalidateSeo();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Snooze failed" };
  }
}
