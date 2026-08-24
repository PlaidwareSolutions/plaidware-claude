"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "../../policy";
import { requeueDelivery } from "./service";

export async function requeueDeliveryAction(
  deliveryRowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOps();
    const id = z.uuid().parse(deliveryRowId);
    await requeueDelivery(id);
    revalidatePath("/ops/webhooks");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Requeue failed" };
  }
}
