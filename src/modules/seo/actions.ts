"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { subscriptions } from "../billing/schema";
import { subscriptionProvisioning } from "../provisioning/schema";
import { seoSnoozes } from "./schema";
import { auditOneSubscription, seoPanelData } from "./service";
import { categorySeverity, CATEGORIES } from "./pagespeed";

const cooldown = new Map<string, number>();

export async function runSeoRecheckAction(
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOps();
    const last = cooldown.get(subscriptionId) ?? 0;
    if (Date.now() - last < 60_000) {
      return { ok: false, error: "Recheck is rate-limited to once a minute per subscription" };
    }
    const prov = await db.query.subscriptionProvisioning.findFirst({
      where: eq(subscriptionProvisioning.subscriptionId, subscriptionId),
    });
    if (!prov?.domainUrl) throw new Error("Set a live domain first");
    cooldown.set(subscriptionId, Date.now());
    await auditOneSubscription(subscriptionId, prov.domainUrl);
    revalidatePath("/monitoring");
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Recheck failed" };
  }
}

export async function snoozeSeoAction(
  subscriptionId: string,
  strategy: "mobile" | "desktop",
  days: 1 | 3 | 7,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await requireOps();
    const sub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });
    if (!sub) throw new Error("Subscription not found");
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
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Snooze failed" };
  }
}
