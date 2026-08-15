"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { requireOps } from "../../policy";
import { dunningStates } from "./ar-schema";
import { tenantPriceOverrides } from "./schema";
import {
  createManualInvoice,
  generateHostingInvoices,
  recordOfflinePayment,
  runDunningSweep,
  setHostingFee,
} from "./ar-service";

type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof Error ? e.message : "Something went wrong",
});

const manualInvoiceSchema = z.object({
  tenantId: z.string().min(1),
  lineItems: z
    .array(z.object({ name: z.string().min(1).max(120), amountCents: z.number().int().min(1) }))
    .min(1)
    .max(20),
  daysUntilDue: z.number().int().min(1).max(90),
  memo: z.string().max(500).optional(),
  collect: z.enum(["auto", "send"]).default("send"),
});

export async function createManualInvoiceAction(
  input: z.infer<typeof manualInvoiceSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = manualInvoiceSchema.parse(input);
    await createManualInvoice({
      ...p,
      contact: { email: session.user.email, name: session.user.name },
    });
    revalidatePath(`/ops/tenants/${p.tenantId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const offlinePaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().min(1),
  method: z.enum(["check", "zelle", "wire", "other"]),
  reference: z.string().max(120).optional(),
  receivedAt: z.string().optional(), // ISO date
  note: z.string().max(300).optional(),
});

export async function recordOfflinePaymentAction(
  input: z.infer<typeof offlinePaymentSchema>,
): Promise<{ ok: true; settled: boolean } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const p = offlinePaymentSchema.parse(input);
    const r = await recordOfflinePayment({
      invoiceId: p.invoiceId,
      amountCents: p.amountCents,
      method: p.method,
      reference: p.reference,
      receivedAt: p.receivedAt ? new Date(p.receivedAt) : undefined,
      recordedByUserId: session.user.id,
      note: p.note,
    });
    revalidatePath("/ops/tenants");
    return { ok: true, settled: r.settled };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Recording failed" };
  }
}

const hostingFeeSchema = z.object({
  subscriptionId: z.string().uuid(),
  monthlyHostingCents: z.number().int().min(0).nullable(),
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable(),
});

export async function setHostingFeeAction(
  input: z.infer<typeof hostingFeeSchema>,
): Promise<ActionResult> {
  try {
    await requireOps();
    const p = hostingFeeSchema.parse(input);
    await setHostingFee(
      p.subscriptionId,
      p.monthlyHostingCents === 0 ? null : p.monthlyHostingCents,
      p.startMonth,
    );
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleDunningPauseAction(
  dunningStateId: string,
  paused: boolean,
): Promise<ActionResult> {
  try {
    await requireOps();
    await db.update(dunningStates).set({ paused }).where(eq(dunningStates.id, dunningStateId));
    revalidatePath("/ops/tenants");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function runDunningSweepAction(): Promise<
  { ok: true; reminded: number; suspended: number; opened: number } | { ok: false; error: string }
> {
  try {
    await requireOps();
    const r = await runDunningSweep();
    revalidatePath("/ops");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sweep failed" };
  }
}

const overrideSchema = z.object({
  tenantId: z.string().min(1),
  componentId: z.string().uuid(),
  /** Cents; null clears the override. */
  amountCents: z.number().int().min(0).nullable(),
});

/** Per-tenant negotiated pricing (billing v2) — applies to future checkouts
 *  and add-ons; existing subscriptions keep their snapshots. */
export async function setTenantPriceOverrideAction(
  input: z.infer<typeof overrideSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = overrideSchema.parse(input);
    if (p.amountCents == null || p.amountCents === 0) {
      await db
        .delete(tenantPriceOverrides)
        .where(
          and(
            eq(tenantPriceOverrides.tenantId, p.tenantId),
            eq(tenantPriceOverrides.componentId, p.componentId),
          ),
        );
    } else {
      await db
        .insert(tenantPriceOverrides)
        .values({
          tenantId: p.tenantId,
          componentId: p.componentId,
          amountCents: p.amountCents,
          createdByUserId: session.user.id,
        })
        .onConflictDoUpdate({
          target: [tenantPriceOverrides.tenantId, tenantPriceOverrides.componentId],
          set: {
            amountCents: p.amountCents,
            stripePriceId: null, // re-mint at next use
            createdByUserId: session.user.id,
          },
        });
    }
    revalidatePath(`/ops/tenants/${p.tenantId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function generateHostingInvoicesAction(month?: string): Promise<
  { ok: true; created: number; skipped: number } | { ok: false; error: string }
> {
  try {
    await requireOps();
    const r = await generateHostingInvoices(month);
    revalidatePath("/ops/tenants");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Generation failed" };
  }
}
