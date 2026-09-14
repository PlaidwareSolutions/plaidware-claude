"use server";

import { z } from "zod";
import { requireOps } from "../../policy";
import {
  createManualInvoice,
  generateHostingInvoices,
  reactivateSubscription,
  recordOfflinePayment,
  runDunningSweep,
  sendCardSetupLink,
  sendPreDueReminders,
  setDunningPaused,
  setHostingFee,
  setTenantPriceOverride,
  suspendSubscriptionManually,
  switchSubscriptionToAutoCharge,
  updateBillingPolicy,
} from "./ar-service";
import { cancelSubscription, changeSubscriptionItems } from "./service";
import { revalidateClientViews } from "@/lib/ops-revalidate";

/** Every ops surface that renders billing state. */
function revalidateBilling(tenantId?: string) {
  revalidateClientViews(tenantId);
}

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
    revalidateBilling(p.tenantId);
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
    revalidateBilling();
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
    const session = await requireOps();
    const p = hostingFeeSchema.parse(input);
    await setHostingFee(
      p.subscriptionId,
      p.monthlyHostingCents === 0 ? null : p.monthlyHostingCents,
      p.startMonth,
      session.user.id,
    );
    revalidateBilling();
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
    const session = await requireOps();
    await setDunningPaused(dunningStateId, paused, session.user.id);
    revalidateBilling();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The same pass the worker runs daily: pre-due notices, then the dunning sweep. */
export async function runDunningSweepAction(): Promise<
  | { ok: true; preDue: number; reminded: number; suspended: number; opened: number }
  | { ok: false; error: string }
> {
  try {
    await requireOps();
    const preDue = await sendPreDueReminders();
    const r = await runDunningSweep();
    revalidateBilling();
    return { ok: true, preDue, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sweep failed" };
  }
}

const policySchema = z.object({
  reminderDays: z.array(z.number().int().min(0).max(90)).min(1).max(6),
  graceDays: z.number().int().min(1).max(90),
  autoSuspend: z.boolean(),
  upcomingReminderDays: z.number().int().min(0).max(30),
});

/** Platform-wide dunning policy — applies to every client. */
export async function updateBillingPolicyAction(
  input: z.infer<typeof policySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    await updateBillingPolicy(policySchema.parse(input), session.user.id);
    revalidateBilling();
    return { ok: true };
  } catch (e) {
    return fail(e);
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
    await setTenantPriceOverride({ ...p, actorUserId: session.user.id });
    revalidateBilling(p.tenantId);
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
    revalidateBilling();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Generation failed" };
  }
}

// ---------------------------------------------------------------------------
// Ops → Billing board
// ---------------------------------------------------------------------------

/** Ops-side cancel (immediate, via Stripe when linked). */
export async function opsCancelSubscriptionAction(subscriptionId: string): Promise<ActionResult> {
  try {
    await requireOps();
    z.string().uuid().parse(subscriptionId);
    await cancelSubscription(subscriptionId);
    revalidateBilling();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const holdSchema = z.object({
  subscriptionId: z.string().uuid(),
  note: z.string().max(300).optional(),
});

/** Manual hold: stays suspended through payments and Stripe syncs until reactivated. */
export async function opsSuspendSubscriptionAction(
  input: z.infer<typeof holdSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireOps();
    const p = holdSchema.parse(input);
    await suspendSubscriptionManually(p.subscriptionId, {
      actorUserId: session.user.id,
      note: p.note?.trim() || null,
    });
    revalidateBilling();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function opsReactivateSubscriptionAction(subscriptionId: string): Promise<ActionResult> {
  try {
    const session = await requireOps();
    z.string().uuid().parse(subscriptionId);
    await reactivateSubscription(subscriptionId, { actorUserId: session.user.id });
    revalidateBilling();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const itemsSchema = z.object({
  subscriptionId: z.string().uuid(),
  addComponentIds: z.array(z.string().uuid()).max(20).default([]),
  removeItemIds: z.array(z.string().uuid()).max(20).default([]),
});

/** Ops-side add-on changes: recurring prorates now, one-time invoices + charges now. */
export async function opsChangeSubscriptionItemsAction(
  input: z.infer<typeof itemsSchema>,
): Promise<{ ok: true; added: number; removed: number } | { ok: false; error: string }> {
  try {
    const session = await requireOps();
    const p = itemsSchema.parse(input);
    if (p.addComponentIds.length === 0 && p.removeItemIds.length === 0) {
      throw new Error("Nothing to change");
    }
    const r = await changeSubscriptionItems({ ...p, actorUserId: session.user.id });
    revalidateBilling();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Change failed" };
  }
}

/** Emailed invoices → charge the card on file at each renewal. */
export async function switchToAutoChargeAction(subscriptionId: string): Promise<ActionResult> {
  try {
    await requireOps();
    z.string().uuid().parse(subscriptionId);
    await switchSubscriptionToAutoCharge(subscriptionId);
    revalidateBilling();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Email the client a Stripe link to add a card; returns the link to copy too. */
export async function sendCardSetupLinkAction(
  tenantId: string,
): Promise<{ ok: true; url: string; sentTo: string | null } | { ok: false; error: string }> {
  try {
    await requireOps();
    z.string().min(1).parse(tenantId);
    const r = await sendCardSetupLink(tenantId);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the link" };
  }
}
