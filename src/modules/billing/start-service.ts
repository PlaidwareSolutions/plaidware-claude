/**
 * Ops starts a subscription on a client's behalf (billing v2): negotiated
 * unit prices and quantities, one-time work charged on the first invoice /
 * already paid offline / waived, collection by emailed invoice or the card
 * on file, and an optional backdated start whose elapsed months ride the
 * first invoice. Everything money-related goes through createCheckout —
 * the single birthplace of a subscription.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { member, organization, user } from "../auth/schema";
import { productComponents, products } from "../catalog/schema";
import { writeAudit } from "../audit/service";
import { emitSubscriptionLifecycle } from "../webhooks_out/service";
import { subscriptionItems, subscriptions } from "./schema";
import { createOfflinePaidInvoice, setTenantPriceOverride, type OfflineInvoiceLine } from "./ar-service";
import {
  createCheckout,
  ensureStripePriceForAmount,
  findCustomerPaymentMethod,
  getTenantOverrides,
  type CheckoutResult,
} from "./service";
import type { LocalSubscriptionStatus } from "./mappers";
import { PAYMENT_METHOD_LABEL, type OfflinePaymentDetails } from "./payment-methods";
import { buildStartPlan, type StartItemInput, type StartPlanLine } from "./start-logic";

export type StartSubscriptionOpts = {
  tenantId: string;
  productId: string;
  items: StartItemInput[];
  collection: { mode: "send_invoice"; daysUntilDue: number } | { mode: "charge_card_now" };
  billFromMonth?: string | null;
  skipTrial: boolean;
  persistOverrides: boolean;
  actorUserId: string;
  /** Stripe customer contact when one has to be created; the owner, else the ops actor. */
  contact: { email: string; name: string };
};

export type StartSubscriptionResult = {
  subscriptionId: string;
  stripeSubscriptionId: string | null;
  status: LocalSubscriptionStatus;
  paymentStatus: CheckoutResult["paymentStatus"];
  firstInvoice: CheckoutResult["firstInvoice"];
  catchUp: { months: string[]; cents: number } | null;
  offlineInvoice: { invoiceId: string; invoiceNumber: string; amountCents: number } | null;
  /** The subscription started but recording the offline payment failed — ops records it from New invoice. */
  offlineInvoiceError: string | null;
};

/** The workspace owner's email + name, for Stripe customer creation and receipts. */
export async function tenantOwnerContact(tenantId: string): Promise<{ email: string; name: string } | null> {
  const [owner] = await db
    .select({ email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, tenantId), eq(member.role, "owner")))
    .limit(1);
  return owner ?? null;
}

export async function startSubscriptionByOps(opts: StartSubscriptionOpts): Promise<StartSubscriptionResult> {
  const product = await db.query.products.findFirst({ where: eq(products.id, opts.productId) });
  if (!product || !product.isActive) throw new Error("Product not found");
  const comps = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, product.id),
  });
  const planRes = buildStartPlan({
    items: opts.items,
    components: comps.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      role: c.role,
      interval: c.interval,
      intervalCount: c.intervalCount,
      isRequired: c.isRequired,
      isActive: c.isActive,
      listCents: c.amountCents,
    })),
    trialDays: product.trialDays,
    skipTrial: opts.skipTrial,
    billFromMonth: opts.billFromMonth,
  });
  if (!planRes.ok) throw new Error(planRes.errors.join(" · "));
  const { plan } = planRes;

  // Charging the card on file needs one; refuse early rather than after Stripe objects exist.
  let paymentMethodId: string | null = null;
  if (opts.collection.mode === "charge_card_now") {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, opts.tenantId),
      columns: { stripeCustomerId: true },
    });
    paymentMethodId = org?.stripeCustomerId ? await findCustomerPaymentMethod(org.stripeCustomerId) : null;
    if (!paymentMethodId) {
      throw new Error("No card on file — start with an emailed invoice, or send a card setup link first");
    }
  }

  // Negotiated prices become the client's standing prices BEFORE checkout so
  // the override's cached Stripe Price is reused; waived and offline lines
  // never become overrides (a $0 or already-paid price must not leak into
  // future add-ons). A line back at list clears a stale override.
  if (opts.persistOverrides) {
    const existing = await getTenantOverrides(opts.tenantId, plan.lines.map((l) => l.componentId));
    for (const l of plan.lines) {
      if (l.settlement.mode !== "invoice") continue;
      const cur = existing.get(l.componentId);
      if (l.amountCents === l.listCents) {
        if (cur) await setTenantPriceOverride({ tenantId: opts.tenantId, componentId: l.componentId, amountCents: null, actorUserId: opts.actorUserId });
      } else if (cur?.amountCents !== l.amountCents) {
        await setTenantPriceOverride({ tenantId: opts.tenantId, componentId: l.componentId, amountCents: l.amountCents, actorUserId: opts.actorUserId });
      }
    }
  }

  const res = await createCheckout({
    tenantId: opts.tenantId,
    productId: opts.productId,
    componentIds: [],
    itemPlan: plan.lines.map((l) => ({
      componentId: l.componentId,
      quantity: l.quantity,
      amountCents: l.amountCents,
      settlement: l.settlement.mode === "offline" ? { mode: "offline" as const } : l.settlement,
    })),
    contact: opts.contact,
    skipAutoPromos: true,
    userId: opts.actorUserId,
    skipTrial: opts.skipTrial,
    ...(plan.backdate ? { backdate: plan.backdate } : {}),
    ...(opts.collection.mode === "send_invoice"
      ? { collection: { method: "send_invoice" as const, daysUntilDue: opts.collection.daysUntilDue } }
      : { offSession: { paymentMethodId: paymentMethodId! } }),
  });

  // A card charge that succeeded makes the subscription live now — the
  // invoice.paid webhook would do the same seconds later (runFinalize does
  // this for setup links too); items that rode that invoice are settled.
  let status = res.status;
  if (res.paymentStatus === "paid" && res.status === "incomplete") {
    await db
      .update(subscriptions)
      .set({ status: "active" })
      .where(and(eq(subscriptions.id, res.subscriptionId), eq(subscriptions.status, "incomplete")));
    await db
      .update(subscriptionItems)
      .set({ status: "paid" })
      .where(and(eq(subscriptionItems.subscriptionId, res.subscriptionId), eq(subscriptionItems.status, "pending")));
    await emitSubscriptionLifecycle(res.subscriptionId, "subscription.activated");
    status = "active";
  }

  // Money already in hand: one paid-out-of-band invoice per distinct payment
  // (normally one). The subscription is real either way, so a failure here is
  // reported, never rolled back.
  let offlineInvoice: StartSubscriptionResult["offlineInvoice"] = null;
  let offlineInvoiceError: string | null = null;
  if (plan.offlineOneTime.length) {
    const groups = new Map<string, { payment: OfflinePaymentDetails; lines: StartPlanLine[] }>();
    for (const l of plan.offlineOneTime) {
      const payment = l.settlement.mode === "offline" ? l.settlement.payment : null;
      if (!payment) continue;
      const key = [payment.method, payment.reference ?? "", payment.receivedAt ?? ""].join("|");
      const g = groups.get(key) ?? { payment, lines: [] };
      g.lines.push(l);
      groups.set(key, g);
    }
    try {
      const overrides = await getTenantOverrides(opts.tenantId, plan.offlineOneTime.map((l) => l.componentId));
      for (const g of groups.values()) {
        const lines: OfflineInvoiceLine[] = [];
        for (const l of g.lines) {
          const c = comps.find((x) => x.id === l.componentId)!;
          const priceId = await ensureStripePriceForAmount(c, product.name, opts.tenantId, l.amountCents, overrides.get(c.id));
          lines.push({ priceId, quantity: l.quantity, name: l.name, unitAmountCents: l.amountCents });
        }
        const r = await createOfflinePaidInvoice({
          tenantId: opts.tenantId,
          subscriptionId: res.subscriptionId,
          contact: opts.contact,
          kind: "product",
          description: `${product.name} — ${g.lines.map((l) => l.name).join(", ")} (paid by ${PAYMENT_METHOD_LABEL[g.payment.method].toLowerCase()})`,
          lines,
          payment: g.payment,
          recordedByUserId: opts.actorUserId,
        });
        offlineInvoice = { invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, amountCents: r.amountCents };
      }
    } catch (e) {
      offlineInvoiceError = e instanceof Error ? e.message : "Recording the offline payment failed";
      console.error("[billing] offline invoice after ops start failed:", e);
    }
  }

  await writeAudit({
    tenantId: opts.tenantId,
    subscriptionId: res.subscriptionId,
    actorUserId: opts.actorUserId,
    kind: "subscription_started_by_ops",
    payload: {
      productId: product.id,
      productName: product.name,
      collection: opts.collection.mode,
      daysUntilDue: opts.collection.mode === "send_invoice" ? opts.collection.daysUntilDue : null,
      billFromMonth: plan.backdate?.billFromMonth ?? null,
      anchorAt: plan.backdate?.anchorAt.toISOString() ?? null,
      catchUpCents: plan.backdate?.cents ?? 0,
      skipTrial: opts.skipTrial,
      persistOverrides: opts.persistOverrides,
      lines: plan.lines.map((l) => ({
        componentId: l.componentId,
        name: l.name,
        amountCents: l.amountCents,
        quantity: l.quantity,
        settlement: l.settlement.mode,
      })),
      firstInvoiceCents: plan.totals.firstInvoiceCents,
      offlineCents: plan.totals.offlineCents,
      stripeSubscriptionId: res.stripeSubscriptionId,
      firstInvoiceId: res.firstInvoice?.stripeInvoiceId ?? null,
      offlineInvoiceId: offlineInvoice?.invoiceId ?? null,
      paymentStatus: res.paymentStatus ?? null,
    },
  });

  return {
    subscriptionId: res.subscriptionId,
    stripeSubscriptionId: res.stripeSubscriptionId,
    status,
    paymentStatus: res.paymentStatus,
    firstInvoice: res.firstInvoice,
    catchUp: plan.backdate ? { months: plan.backdate.months, cents: plan.backdate.cents } : null,
    offlineInvoice,
    offlineInvoiceError,
  };
}
