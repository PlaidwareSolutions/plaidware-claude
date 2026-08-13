"use server";

import { revalidatePath } from "next/cache";
import { requireMembership, requireOps } from "../../policy";
import { getSubscriptionForTenant } from "../billing/queries";
import { acknowledgeIncident, mintIngestKey } from "./service";

export async function rotateIngestKeyAction(
  tenantId: string,
  subscriptionId: string,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  try {
    await requireMembership(tenantId, "write");
    const sub = await getSubscriptionForTenant(subscriptionId, tenantId);
    if (!sub) throw new Error("Subscription not found");
    const key = await mintIngestKey(subscriptionId);
    revalidatePath("/monitoring");
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
    revalidatePath("/ops/incidents");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Ack failed" };
  }
}
