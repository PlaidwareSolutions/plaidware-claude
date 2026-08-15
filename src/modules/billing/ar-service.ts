import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "../../db";
import { getStripe } from "../../lib/stripe";
import { emailButton, emailShell, sendEmail } from "../../lib/email";
import { formatCents } from "../../lib/money";
import { env } from "../../env";
import { member, organization, user } from "../auth/schema";
import { invoices, subscriptions } from "./schema";
import { billingPolicy, dunningStates, payments } from "./ar-schema";
import { daysPastDue, decideDunningAction, isCovered } from "./dunning-logic";
import { ensureTenantStripeCustomer } from "./service";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function getBillingPolicy() {
  const row = await db.query.billingPolicy.findFirst();
  if (row) return row;
  const [created] = await db
    .insert(billingPolicy)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.query.billingPolicy.findFirst())!;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function tenantBillingContacts(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, tenantId));
  const billingRoles = rows.filter((r) => ["owner", "admin", "billing"].includes(r.role));
  return [...new Set(billingRoles.map((r) => r.email))];
}

async function paidTotalCents(invoiceId: string): Promise<number> {
  const rows = await db.query.payments.findMany({
    where: eq(payments.invoiceId, invoiceId),
    columns: { amountCents: true },
  });
  return rows.reduce((s, p) => s + p.amountCents, 0);
}

// ---------------------------------------------------------------------------
// Manual invoices (PRD §4.5) — Stripe hosted invoices via send_invoice
// ---------------------------------------------------------------------------

export async function createManualInvoice(opts: {
  tenantId: string;
  lineItems: { name: string; amountCents: number }[];
  daysUntilDue: number;
  memo?: string;
  contact: { email: string; name: string };
  /** "auto" charges the card on file immediately (falls back to a hosted
   *  payment link when none exists); "send" always emails the link. */
  collect?: "auto" | "send";
}): Promise<{ invoiceId: string; hostedInvoiceUrl: string | null; autoCharged: boolean }> {
  const stripe = getStripe();
  const customerId = await ensureTenantStripeCustomer(opts.tenantId, opts.contact);

  let autoCharge = false;
  if (opts.collect === "auto") {
    const customer = (await stripe.customers.retrieve(customerId)) as import("stripe").Stripe.Customer;
    autoCharge = Boolean(customer.invoice_settings?.default_payment_method);
  }

  const invoice = await stripe.invoices.create({
    customer: customerId,
    ...(autoCharge
      ? { collection_method: "charge_automatically" as const }
      : { collection_method: "send_invoice" as const, days_until_due: opts.daysUntilDue }),
    description: opts.memo,
    metadata: { tenant_id: opts.tenantId, invoice_kind: "manual" },
  });
  for (const li of opts.lineItems) {
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      description: li.name,
      amount: li.amountCents,
      currency: "usd",
    });
  }
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
  if (autoCharge) {
    await stripe.invoices.pay(finalized.id!).catch(() => {});
  } else {
    // Stripe emails the customer the hosted payment link.
    await stripe.invoices.sendInvoice(finalized.id!).catch(() => {});
  }

  const [row] = await db
    .insert(invoices)
    .values({
      tenantId: opts.tenantId,
      kind: "manual",
      invoiceNumber: finalized.number ?? `MAN-${finalized.id!.slice(-8).toUpperCase()}`,
      status: "open",
      amountDueCents: finalized.amount_due,
      currency: finalized.currency,
      description: opts.memo,
      lineItems: opts.lineItems,
      stripeInvoiceId: finalized.id!,
      hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      invoicePdfUrl: finalized.invoice_pdf ?? null,
      dueDate: finalized.due_date ? new Date(finalized.due_date * 1000) : null,
    })
    .onConflictDoNothing({ target: invoices.stripeInvoiceId })
    .returning();
  return {
    invoiceId: row.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
    autoCharged: autoCharge,
  };
}

/** Pre-due reminders (billing v2): open invoices with a due date inside the
 *  configured window get one "payment due soon" email, deduped by stamp. */
export async function sendPreDueReminders(now = new Date()): Promise<number> {
  const policy = await getBillingPolicy();
  const windowEnd = new Date(now.getTime() + policy.upcomingReminderDays * 86_400_000);
  const upcoming = await db.query.invoices.findMany({
    where: and(
      eq(invoices.status, "open"),
      isNull(invoices.upcomingReminderSentAt),
      gt(invoices.dueDate, now),
      lt(invoices.dueDate, windowEnd),
    ),
  });
  let sent = 0;
  for (const inv of upcoming) {
    const contacts = await tenantBillingContacts(inv.tenantId);
    if (contacts.length) {
      await sendEmail({
        to: contacts[0],
        subject: `Payment due soon — invoice ${inv.invoiceNumber}`,
        html: emailShell(
          "Payment due soon",
          `<p>Invoice ${inv.invoiceNumber} for ${formatCents(inv.amountDueCents - inv.amountPaidCents)} is due on ${inv.dueDate!.toLocaleDateString()}.</p>` +
            (inv.hostedInvoiceUrl
              ? emailButton(inv.hostedInvoiceUrl, "Pay now")
              : emailButton(`${env.APP_BASE_URL}/billing`, "View billing")),
        ),
      });
    }
    await db
      .update(invoices)
      .set({ upcomingReminderSentAt: now })
      .where(eq(invoices.id, inv.id));
    sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Hosting fees as Stripe invoices (PRD §6 Q-Hosting: unified in Stripe)
// ---------------------------------------------------------------------------

export function previousMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function setHostingFee(
  subscriptionId: string,
  monthlyHostingCents: number | null,
  startMonth: string | null,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({
      monthlyHostingCents,
      hostingBillingStartMonth: monthlyHostingCents == null ? null : startMonth,
    })
    .where(eq(subscriptions.id, subscriptionId));
}

/** Generate hosting invoices for `month` (default: last month). Idempotent
 *  per (subscription, month) via the partial unique index. */
export async function generateHostingInvoices(
  month = previousMonth(),
): Promise<{ created: number; skipped: number }> {
  const stripe = getStripe();
  const candidates = await db.query.subscriptions.findMany({
    where: and(
      inArray(subscriptions.status, ["active", "trialing", "past_due"]),
      sql`${subscriptions.monthlyHostingCents} > 0`,
      sql`${subscriptions.hostingBillingStartMonth} <= ${month}`,
    ),
  });
  let created = 0;
  let skipped = 0;

  for (const sub of candidates) {
    const existing = await db.query.invoices.findFirst({
      where: and(
        eq(invoices.subscriptionId, sub.id),
        eq(invoices.billingMonth, month),
        eq(invoices.kind, "hosting"),
      ),
    });
    if (existing) {
      skipped++;
      continue;
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, sub.tenantId),
    });
    if (!org?.stripeCustomerId) {
      skipped++;
      continue;
    }
    // Auto-charge when a default payment method exists; hosted link otherwise.
    const customer = (await stripe.customers.retrieve(org.stripeCustomerId)) as Stripe.Customer;
    const hasDefaultPm = Boolean(customer.invoice_settings?.default_payment_method);

    const invoice = await stripe.invoices.create({
      customer: org.stripeCustomerId,
      ...(hasDefaultPm
        ? { collection_method: "charge_automatically" as const }
        : { collection_method: "send_invoice" as const, days_until_due: 14 }),
      description: `Hosting — ${month}`,
      metadata: {
        tenant_id: sub.tenantId,
        subscription_id: sub.id,
        invoice_kind: "hosting",
        billing_month: month,
      },
    });
    await stripe.invoiceItems.create({
      customer: org.stripeCustomerId,
      invoice: invoice.id,
      description: `Managed hosting — ${month}`,
      amount: sub.monthlyHostingCents!,
      currency: "usd",
    });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id!);
    if (!hasDefaultPm) await stripe.invoices.sendInvoice(finalized.id!).catch(() => {});

    try {
      await db.insert(invoices).values({
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
        kind: "hosting",
        billingMonth: month,
        invoiceNumber: finalized.number ?? `HOST-${finalized.id!.slice(-8).toUpperCase()}`,
        status: "open",
        amountDueCents: finalized.amount_due,
        currency: finalized.currency,
        description: `Hosting — ${month}`,
        lineItems: [{ name: `Managed hosting — ${month}`, amountCents: sub.monthlyHostingCents! }],
        stripeInvoiceId: finalized.id!,
        hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
        invoicePdfUrl: finalized.invoice_pdf ?? null,
        dueDate: finalized.due_date ? new Date(finalized.due_date * 1000) : null,
      });
      created++;
    } catch (e) {
      // Unique-violation race: another run created it — void ours.
      const isUnique = typeof e === "object" && e !== null && "code" in e && e.code === "23505";
      if (!isUnique) throw e;
      await stripe.invoices.voidInvoice(finalized.id!).catch(() => {});
      skipped++;
    }
  }
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Payments (webhook + offline) and reactivation
// ---------------------------------------------------------------------------

export async function recordPaymentRow(opts: {
  invoiceId: string;
  tenantId: string;
  amountCents: number;
  method: "stripe_card" | "stripe_ach" | "check" | "zelle" | "wire" | "other";
  reference?: string | null;
  receivedAt?: Date;
  recordedByUserId?: string | null;
  note?: string | null;
  sendReceipt?: boolean;
}): Promise<void> {
  await db.insert(payments).values({
    invoiceId: opts.invoiceId,
    tenantId: opts.tenantId,
    amountCents: opts.amountCents,
    method: opts.method,
    reference: opts.reference ?? null,
    receivedAt: opts.receivedAt ?? new Date(),
    recordedByUserId: opts.recordedByUserId ?? null,
    note: opts.note ?? null,
  });

  if (opts.sendReceipt !== false) {
    const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, opts.invoiceId) });
    const contacts = await tenantBillingContacts(opts.tenantId);
    if (inv && contacts.length) {
      void sendEmail({
        to: contacts[0],
        subject: `Payment received — ${inv.invoiceNumber}`,
        html: emailShell(
          "Payment received",
          `<p>We received ${formatCents(opts.amountCents)} toward invoice ${inv.invoiceNumber}. Thank you.</p>` +
            emailButton(`${env.APP_BASE_URL}/billing`, "View billing"),
        ),
      });
    }
  }
}

/** Ops records an offline payment (check/Zelle/wire). Partials supported;
 *  full coverage marks the Stripe invoice paid out-of-band. */
export async function recordOfflinePayment(opts: {
  invoiceId: string;
  amountCents: number;
  method: "check" | "zelle" | "wire" | "other";
  reference?: string;
  receivedAt?: Date;
  recordedByUserId: string;
  note?: string;
}): Promise<{ settled: boolean }> {
  const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, opts.invoiceId) });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "paid" || inv.status === "void") {
    throw new Error(`Invoice is already ${inv.status}`);
  }

  await recordPaymentRow({ ...opts, tenantId: inv.tenantId });
  const covered = isCovered(inv.amountDueCents, await paidTotalCents(inv.id));

  if (covered) {
    if (inv.stripeInvoiceId) {
      await getStripe()
        .invoices.pay(inv.stripeInvoiceId, { paid_out_of_band: true })
        .catch((e) => console.error("[ar] out-of-band mark failed:", e));
    }
    await db
      .update(invoices)
      .set({ status: "paid", paidAt: new Date(), amountPaidCents: inv.amountDueCents })
      .where(eq(invoices.id, inv.id));
    await resolveDunningForInvoice(inv.id);
  } else {
    await db
      .update(invoices)
      .set({ amountPaidCents: await paidTotalCents(inv.id) })
      .where(eq(invoices.id, inv.id));
  }
  return { settled: covered };
}

// ---------------------------------------------------------------------------
// Dunning engine (PRD §4.5)
// ---------------------------------------------------------------------------

export async function ensureDunningCase(invoiceId: string, tenantId: string): Promise<void> {
  await db
    .insert(dunningStates)
    .values({ invoiceId, tenantId })
    .onConflictDoNothing({ target: dunningStates.invoiceId });
}

/** Invoice settled → close its case and reactivate the tenant if clean. */
export async function resolveDunningForInvoice(invoiceId: string): Promise<void> {
  const dcase = await db.query.dunningStates.findFirst({
    where: eq(dunningStates.invoiceId, invoiceId),
  });
  if (!dcase) return;
  await db
    .update(dunningStates)
    .set({ resolvedAt: new Date() })
    .where(eq(dunningStates.id, dcase.id));

  // Auto-reactivation: no other unresolved cases for this tenant.
  const openCases = await db.query.dunningStates.findMany({
    where: and(
      eq(dunningStates.tenantId, dcase.tenantId),
      isNull(dunningStates.resolvedAt),
    ),
  });
  if (openCases.length > 0) return;

  const suspended = await db.query.subscriptions.findMany({
    where: and(eq(subscriptions.tenantId, dcase.tenantId), eq(subscriptions.status, "suspended")),
  });
  if (suspended.length === 0) return;
  await db
    .update(subscriptions)
    .set({ status: "active" })
    .where(and(eq(subscriptions.tenantId, dcase.tenantId), eq(subscriptions.status, "suspended")));

  const contacts = await tenantBillingContacts(dcase.tenantId);
  if (contacts.length) {
    void sendEmail({
      to: contacts[0],
      subject: "Your Plaidware services are reactivated",
      html: emailShell(
        "Welcome back",
        `<p>Payment received — your services are active again. Thanks for getting it sorted.</p>` +
          emailButton(`${env.APP_BASE_URL}/dashboard`, "Open dashboard"),
      ),
    });
  }
}

/** Daily sweep: open cases for past-due invoices → remind / suspend. */
export async function runDunningSweep(now = new Date()): Promise<{
  reminded: number;
  suspended: number;
  opened: number;
}> {
  const policy = await getBillingPolicy();

  // Open cases for newly past-due invoices. Auto-charge invoices have no
  // due date — a failed charge is past due from the moment it fails.
  const pastDue = await db.query.invoices.findMany({
    where: or(
      and(eq(invoices.status, "open"), lt(invoices.dueDate, now)),
      eq(invoices.status, "failed"),
    ),
  });
  let opened = 0;
  for (const inv of pastDue) {
    const existing = await db.query.dunningStates.findFirst({
      where: eq(dunningStates.invoiceId, inv.id),
    });
    if (!existing) {
      await ensureDunningCase(inv.id, inv.tenantId);
      opened++;
    }
  }

  const cases = await db.query.dunningStates.findMany({
    where: isNull(dunningStates.resolvedAt),
  });
  let reminded = 0;
  let suspendedCount = 0;

  for (const dcase of cases) {
    const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, dcase.invoiceId) });
    if (!inv) continue;
    if (inv.status === "paid" || inv.status === "void") {
      await resolveDunningForInvoice(inv.id);
      continue;
    }
    const effectiveDue = inv.dueDate ?? inv.createdAt;
    const action = decideDunningAction(policy, dcase, daysPastDue(effectiveDue, now));
    if (action.kind === "none") continue;

    const contacts = await tenantBillingContacts(dcase.tenantId);

    if (action.kind === "remind") {
      if (contacts.length) {
        await sendEmail({
          to: contacts[0],
          subject: action.isFinalWarning
            ? `Final notice — invoice ${inv.invoiceNumber} is overdue`
            : `Reminder — invoice ${inv.invoiceNumber} is overdue`,
          html: emailShell(
            action.isFinalWarning ? "Final notice before suspension" : "Payment reminder",
            `<p>Invoice ${inv.invoiceNumber} for ${formatCents(inv.amountDueCents)} is past due.</p>` +
              (action.isFinalWarning
                ? `<p><strong>Your services will be suspended</strong> if payment isn't received within ${policy.graceDays - (policy.reminderDays.at(-1) ?? 0) || "a few"} days.</p>`
                : "") +
              (inv.hostedInvoiceUrl
                ? emailButton(inv.hostedInvoiceUrl, "Pay now")
                : emailButton(`${env.APP_BASE_URL}/billing`, "View billing")),
          ),
        });
      }
      await db
        .update(dunningStates)
        .set({ remindersSent: dcase.remindersSent + 1, lastReminderAt: now })
        .where(eq(dunningStates.id, dcase.id));
      reminded++;
    } else if (action.kind === "suspend") {
      await db
        .update(subscriptions)
        .set({ status: "suspended" })
        .where(
          and(
            eq(subscriptions.tenantId, dcase.tenantId),
            inArray(subscriptions.status, ["active", "trialing", "past_due"]),
          ),
        );
      await db
        .update(dunningStates)
        .set({ suspendedAt: now })
        .where(eq(dunningStates.id, dcase.id));
      if (contacts.length) {
        await sendEmail({
          to: contacts[0],
          subject: "Your Plaidware services are suspended",
          html: emailShell(
            "Services suspended",
            `<p>Invoice ${inv.invoiceNumber} (${formatCents(inv.amountDueCents)}) remained unpaid past the grace period, so your services are suspended. Pay now and everything reactivates automatically.</p>` +
              (inv.hostedInvoiceUrl
                ? emailButton(inv.hostedInvoiceUrl, "Pay now")
                : emailButton(`${env.APP_BASE_URL}/billing`, "View billing")),
          ),
        });
      }
      if (env.OPS_EMAIL) {
        void sendEmail({
          to: env.OPS_EMAIL,
          subject: `[Plaidware ops] Tenant suspended — invoice ${inv.invoiceNumber}`,
          html: emailShell(
            "Automatic suspension",
            `<p>Tenant ${dcase.tenantId} was suspended over invoice ${inv.invoiceNumber} (${formatCents(inv.amountDueCents)}). Product-app takedown remains a manual step (PRD Q1).</p>`,
          ),
        });
      }
      suspendedCount++;
    }
  }
  return { reminded, suspended: suspendedCount, opened };
}
