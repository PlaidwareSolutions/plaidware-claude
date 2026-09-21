/**
 * Pure rules for an ops-started subscription (billing v2): validates the
 * negotiated lines, splits them into what Stripe bills, what was already
 * paid offline and what is waived, and — for a backdated start — builds the
 * per-month catch-up lines that ride the first invoice. No DB, no Stripe.
 */
import { formatDate, formatDay, formatMonth, monthBounds, monthKey, monthKeysBetween } from "@/lib/dates";
import { isRecurringKind, itemMrrCents, resolveInterval } from "./mappers";
import { isOfflinePaymentMethod, type OfflinePaymentDetails } from "./payment-methods";

export type StartSettlement =
  | { mode: "invoice" }
  | { mode: "waive" }
  | { mode: "offline"; payment: OfflinePaymentDetails };

export type StartItemInput = {
  componentId: string;
  /** Unit price in cents (negotiated). */
  amountCents: number;
  quantity: number;
  /** One-time components only; recurring lines are always invoiced. */
  settlement?: StartSettlement;
};

/** What createCheckout is told per component when ops (or a setup link) decides the terms. */
export type CheckoutItemPlan = {
  componentId: string;
  quantity?: number;
  /** Explicit unit price; absent → tenant override → list. */
  amountCents?: number;
  settlement?: { mode: "invoice" } | { mode: "waive" } | { mode: "offline"; invoiceId?: string | null };
};

export type StartComponent = {
  id: string;
  name: string;
  kind: string;
  role: string;
  interval: string | null;
  intervalCount: number;
  isRequired: boolean;
  isActive: boolean;
  listCents: number;
};

export type StartPlanLine = {
  componentId: string;
  name: string;
  kind: string;
  role: string;
  interval: string | null;
  intervalCount: number;
  listCents: number;
  amountCents: number;
  quantity: number;
  /** unit × quantity */
  lineCents: number;
  settlement: StartSettlement;
};

export type CatchUpLine = {
  componentId: string;
  /** "Subscription — July 2026" / "Maintenance — Jul 1 – Sep 30, 2026 (prorated)" */
  name: string;
  periodStart: Date;
  periodEnd: Date;
  cents: number;
  quantity: number;
  unitCents: number;
  prorated: boolean;
};

export type StartBackdate = {
  billFromMonth: string;
  /** Local midnight on the 1st of the bill-from month — Stripe's backdated start. */
  startAt: Date;
  /** Local midnight on the 1st of next month — Stripe's billing cycle anchor. */
  anchorAt: Date;
  months: string[];
  lines: CatchUpLine[];
  cents: number;
};

export type StartPlan = {
  lines: StartPlanLine[];
  stripeRecurring: StartPlanLine[];
  /** One-time lines Stripe bills on the first invoice (invoice or waive). */
  stripeOneTime: StartPlanLine[];
  /** One-time lines already paid outside Stripe — never on the first invoice. */
  offlineOneTime: StartPlanLine[];
  needsStripeSubscription: boolean;
  backdate: StartBackdate | null;
  totals: {
    firstInvoiceCents: number;
    offlineCents: number;
    waivedListCents: number;
    monthlyCents: number;
    yearlyCents: number;
    trialApplied: boolean;
  };
};

export const MAX_BACKDATE_MONTHS = 24;
export const MAX_QUANTITY = 999;

const DAY_MS = 86_400_000;

function addInterval(d: Date, interval: "week" | "month" | "year", count: number): Date {
  const x = new Date(d);
  if (interval === "week") x.setUTCDate(x.getUTCDate() + 7 * count);
  else if (interval === "month") x.setUTCMonth(x.getUTCMonth() + count);
  else x.setUTCFullYear(x.getUTCFullYear() + count);
  return x;
}

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

export type CatchUpInput = {
  billFromMonth: string;
  now?: Date;
  timeZone?: string;
  /** Recurring lines with UNIT prices. */
  lines: {
    componentId: string;
    name: string;
    kind: string;
    interval: string | null;
    intervalCount: number;
    amountCents: number;
    quantity: number;
  }[];
};

/**
 * Calendar-month catch-up from the bill-from month through the current month:
 * monthly items get one line per month (with that month's period); anything
 * else (yearly, quarterly, weekly) gets one line prorated from the 1st of the
 * bill-from month to the anchor (the 1st of next month).
 */
export function buildCatchUp(input: CatchUpInput): { ok: true; backdate: StartBackdate } | { ok: false; error: string } {
  const tz = input.timeZone;
  const nowKey = monthKey(input.now ?? new Date(), tz);
  if (!/^\d{4}-\d{2}$/.test(input.billFromMonth)) return { ok: false, error: "Bill-from month is invalid" };
  if (input.billFromMonth > nowKey) return { ok: false, error: "Bill-from month can't be in the future" };
  const months = monthKeysBetween(input.billFromMonth, nowKey);
  if (months.length > MAX_BACKDATE_MONTHS) {
    return { ok: false, error: `Bill-from month can't be more than ${MAX_BACKDATE_MONTHS} months back` };
  }
  if (input.lines.length === 0) return { ok: false, error: "Backdating needs a recurring item" };
  const startAt = monthBounds(input.billFromMonth, tz).start;
  const anchorAt = monthBounds(nowKey, tz).end;
  const lines: CatchUpLine[] = [];
  for (const l of input.lines) {
    const iv = resolveInterval(l) ?? { interval: "month" as const, intervalCount: 1 };
    const lineCents = l.amountCents * l.quantity;
    const label = l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name;
    if (iv.interval === "month" && iv.intervalCount === 1) {
      for (const key of months) {
        const b = monthBounds(key, tz);
        lines.push({
          componentId: l.componentId,
          name: `${label} — ${formatMonth(key)}`,
          periodStart: b.start,
          periodEnd: b.end,
          cents: lineCents,
          quantity: l.quantity,
          unitCents: l.amountCents,
          prorated: false,
        });
      }
    } else {
      const elapsed = daysBetween(startAt, anchorAt);
      const span = daysBetween(startAt, addInterval(startAt, iv.interval, iv.intervalCount));
      lines.push({
        componentId: l.componentId,
        name: `${label} — ${formatDay(startAt)} – ${formatDate(new Date(anchorAt.getTime() - 1))} (prorated)`,
        periodStart: startAt,
        periodEnd: anchorAt,
        cents: Math.round((lineCents * elapsed) / span),
        quantity: l.quantity,
        unitCents: l.amountCents,
        prorated: true,
      });
    }
  }
  return {
    ok: true,
    backdate: {
      billFromMonth: input.billFromMonth,
      startAt,
      anchorAt,
      months,
      lines,
      cents: lines.reduce((s, l) => s + l.cents, 0),
    },
  };
}

export function buildStartPlan(input: {
  items: StartItemInput[];
  components: StartComponent[];
  trialDays?: number | null;
  skipTrial?: boolean;
  billFromMonth?: string | null;
  now?: Date;
  /** Display zone for month boundaries; defaults to the app's display zone. */
  timeZone?: string;
}): { ok: true; plan: StartPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const now = input.now ?? new Date();
  const byId = new Map(input.components.map((c) => [c.id, c]));

  if (input.items.length === 0) errors.push("Include at least one item");
  const seen = new Set<string>();
  const lines: StartPlanLine[] = [];
  let waivedListCents = 0;

  for (const item of input.items) {
    const c = byId.get(item.componentId);
    if (!c || !c.isActive) {
      errors.push("Unknown or inactive component");
      continue;
    }
    if (seen.has(c.id)) {
      errors.push(`${c.name} is listed twice`);
      continue;
    }
    seen.add(c.id);
    const recurring = isRecurringKind(c.kind);
    if (!Number.isInteger(item.amountCents) || item.amountCents < 0) errors.push(`${c.name}: enter a valid amount`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      errors.push(`${c.name}: quantity must be 1–${MAX_QUANTITY}`);
    }
    // Quantity only means something on recurring add-ons; the main charge and one-time work are single.
    const quantity = recurring && c.role !== "base" ? Math.max(1, Math.floor(item.quantity || 1)) : 1;
    let settlement: StartSettlement = item.settlement ?? { mode: "invoice" };
    let amountCents = Math.max(0, Math.floor(item.amountCents || 0));
    if (recurring) {
      if (settlement.mode !== "invoice") errors.push(`${c.name}: only one-time items can be settled offline or waived`);
      settlement = { mode: "invoice" };
    } else if (settlement.mode === "waive") {
      waivedListCents += c.listCents;
      amountCents = 0;
    } else if (settlement.mode === "offline") {
      if (!settlement.payment || !isOfflinePaymentMethod(settlement.payment.method)) {
        errors.push(`${c.name}: pick how it was paid`);
      }
      if (amountCents <= 0) errors.push(`${c.name}: an offline payment needs an amount — use Waive for $0`);
    }
    lines.push({
      componentId: c.id,
      name: c.name,
      kind: c.kind,
      role: c.role,
      interval: c.interval,
      intervalCount: c.intervalCount,
      listCents: c.listCents,
      amountCents,
      quantity,
      lineCents: amountCents * quantity,
      settlement,
    });
  }

  // The main charge and every required component must be on the plan.
  for (const c of input.components) {
    if (!c.isActive || seen.has(c.id)) continue;
    if (c.role === "base") errors.push(`${c.name} (the main charge) must be included`);
    else if (c.isRequired) errors.push(`${c.name} is required`);
  }

  const stripeRecurring = lines.filter((l) => isRecurringKind(l.kind));
  const stripeOneTime = lines.filter((l) => !isRecurringKind(l.kind) && l.settlement.mode !== "offline");
  const offlineOneTime = lines.filter((l) => !isRecurringKind(l.kind) && l.settlement.mode === "offline");
  if (lines.length > 0 && stripeRecurring.length === 0 && offlineOneTime.length === 0 && stripeOneTime.every((l) => l.lineCents === 0)) {
    errors.push("Include at least one item to bill");
  }

  // ---- backdate: calendar months from bill-from through the current month
  let backdate: StartBackdate | null = null;
  if (input.billFromMonth) {
    const cu = buildCatchUp({
      billFromMonth: input.billFromMonth,
      now,
      timeZone: input.timeZone,
      lines: stripeRecurring.map((l) => ({
        componentId: l.componentId,
        name: l.name,
        kind: l.kind,
        interval: l.interval,
        intervalCount: l.intervalCount,
        amountCents: l.amountCents,
        quantity: l.quantity,
      })),
    });
    if (cu.ok) backdate = cu.backdate;
    else errors.push(cu.error);
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  const trialApplied = !input.skipTrial && (input.trialDays ?? 0) > 0 && !backdate;
  let monthlyCents = 0;
  let yearlyCents = 0;
  for (const l of stripeRecurring) {
    const iv = resolveInterval(l);
    if (iv?.interval === "year") yearlyCents += Math.round(l.lineCents / iv.intervalCount);
    else monthlyCents += itemMrrCents(l, l.lineCents);
  }
  const oneTimeNow = stripeOneTime.reduce((s, l) => s + l.lineCents, 0);
  const recurringNow = backdate ? backdate.cents : trialApplied ? 0 : stripeRecurring.reduce((s, l) => s + l.lineCents, 0);

  return {
    ok: true,
    plan: {
      lines,
      stripeRecurring,
      stripeOneTime,
      offlineOneTime,
      needsStripeSubscription: stripeRecurring.length > 0,
      backdate,
      totals: {
        firstInvoiceCents: recurringNow + oneTimeNow,
        offlineCents: offlineOneTime.reduce((s, l) => s + l.lineCents, 0),
        waivedListCents,
        monthlyCents,
        yearlyCents,
        trialApplied,
      },
    },
  };
}
