"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { toCents } from "../../lib/money";
import { appCostSamples, hostedApps, productHostedApps } from "./schema";
import { currentMonth, syncRailwayCosts } from "./service";

type R = { ok: boolean; error?: string };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : "Failed" });

const appSchema = z.object({
  provider: z.enum(["railway", "other"]),
  externalRef: z.string().min(3).max(100),
  label: z.string().min(2).max(80),
  productId: z.string().uuid().nullable(),
});

export async function registerHostedAppAction(input: z.infer<typeof appSchema>): Promise<R> {
  try {
    await requireOps();
    const p = appSchema.parse(input);
    const [app] = await db
      .insert(hostedApps)
      .values({ provider: p.provider, externalRef: p.externalRef.trim(), label: p.label })
      .returning();
    if (p.productId) {
      await db
        .insert(productHostedApps)
        .values({ productId: p.productId, hostedAppId: app.id })
        .onConflictDoNothing();
    }
    revalidatePath("/ops/costs");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleAppProductLinkAction(
  hostedAppId: string,
  productId: string,
  linked: boolean,
): Promise<R> {
  try {
    await requireOps();
    if (linked) {
      await db
        .insert(productHostedApps)
        .values({ hostedAppId, productId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(productHostedApps)
        .where(
          and(
            eq(productHostedApps.hostedAppId, hostedAppId),
            eq(productHostedApps.productId, productId),
            isNull(productHostedApps.subscriptionId),
          ),
        );
    }
    revalidatePath("/ops/costs");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function upsertManualCostAction(
  hostedAppId: string,
  month: string,
  amount: string,
): Promise<R> {
  try {
    await requireOps();
    const costCents = toCents(amount);
    await db
      .insert(appCostSamples)
      .values({ hostedAppId, month, costCents, source: "manual" })
      .onConflictDoUpdate({
        target: [appCostSamples.hostedAppId, appCostSamples.month, appCostSamples.source],
        set: { costCents, createdAt: new Date() },
      });
    revalidatePath("/ops/costs");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function syncRailwayNowAction(): Promise<
  { ok: true; apps: number; totalCents: number } | { ok: false; error: string }
> {
  try {
    await requireOps();
    const r = await syncRailwayCosts(currentMonth());
    revalidatePath("/ops/costs");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sync failed" };
  }
}
