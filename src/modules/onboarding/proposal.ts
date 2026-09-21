import {
  intervalLabel,
  isRecurringKind,
  itemMrrCents,
  resolveInterval,
} from "../billing/mappers";
import type { OfflinePaymentMethod } from "../billing/payment-methods";
import { buildCatchUp, type CheckoutItemPlan } from "../billing/start-logic";

/**
 * One product's locked configuration inside a setup invite. Prices live on
 * the invite (`items[].priceCents`, null = list) and only become tenant
 * overrides when the client commits — so a link that is never used leaves
 * nothing behind. Legacy rows carry `componentIds` only.
 */
/** How a one-time component on a setup link settles; recurring items are always invoiced. */
export type InviteItemSettlement =
  | { mode: "invoice" }
  | { mode: "waive" }
  | {
      mode: "offline";
      /** The paid-out-of-band Hub invoice created when the link was made; linked to the subscription at checkout. */
      invoiceId: string | null;
      payment: { method: OfflinePaymentMethod; reference: string | null; receivedAt: string | null };
    };

export type InviteProductEntry = {
  productId: string;
  items?: { componentId: string; priceCents: number | null; quantity?: number; settlement?: InviteItemSettlement }[];
  /** Legacy shape (pre invite-held pricing); read-compat only. */
  componentIds?: string[];
  domainUrl: string | null;
  /** "YYYY-MM": bill calendar months from here; the catch-up rides the first invoice (billing v2). */
  billFromMonth?: string | null;
};

export function entryComponentIds(entry: InviteProductEntry): string[] {
  return entry.items ? entry.items.map((i) => i.componentId) : (entry.componentIds ?? []);
}

/** componentId → held price for the items that carry one. */
export function entryPriceMap(entry: InviteProductEntry): Map<string, number> {
  return new Map(
    (entry.items ?? [])
      .filter((i): i is { componentId: string; priceCents: number } => i.priceCents != null)
      .map((i) => [i.componentId, i.priceCents]),
  );
}

/** What createCheckout is told for each held item (quantity + settlement; prices come from the held overrides). */
export function entryItemPlan(entry: InviteProductEntry): CheckoutItemPlan[] {
  if (!entry.items) return (entry.componentIds ?? []).map((componentId) => ({ componentId, quantity: 1 }));
  return entry.items.map((i) => ({
    componentId: i.componentId,
    quantity: i.quantity ?? 1,
    ...(i.settlement?.mode === "offline"
      ? { settlement: { mode: "offline" as const, invoiceId: i.settlement.invoiceId } }
      : i.settlement?.mode === "waive"
        ? { settlement: { mode: "waive" as const } }
        : {}),
  }));
}

export type ProposalLine = {
  name: string;
  /** Line total (unit × quantity); 0 when waived. */
  amountCents: number;
  unitAmountCents: number;
  quantity: number;
  cadence: string;
  oneTime: boolean;
  /** Already paid outside Stripe — shown as paid, never charged. */
  settled: boolean;
  waived: boolean;
  /** A backdated month (or prorated span) on the first invoice. */
  catchUp: boolean;
};

export type ProposalProduct = {
  productId: string;
  productName: string;
  componentIds: string[];
  domainUrl: string | null;
  lines: ProposalLine[];
  dueTodayCents: number;
  monthlyCents: number;
  yearlyCents: number;
  billFromMonth: string | null;
  catchUpCents: number;
  items: CheckoutItemPlan[];
};

export type ProposalComponent = {
  id: string;
  name: string;
  kind: string;
  interval?: string | null;
  intervalCount?: number | null;
  amountCents: number;
  sortOrder: number;
};

/**
 * Price one product's selection: the invite's held prices win, then any
 * tenant override passed in, then list. First-period totals — or, when the
 * entry is backdated, the catch-up months computed as of `now` (so a link
 * paid next month bills that month too). Offline-settled and waived one-time
 * lines never count toward "due today".
 */
export function buildProductProposal(
  entry: InviteProductEntry,
  productName: string,
  comps: ProposalComponent[],
  overrideAmounts: Map<string, number>,
  opts: { now?: Date; timeZone?: string } = {},
): ProposalProduct {
  const held = entryPriceMap(entry);
  const qtyOf = new Map((entry.items ?? []).map((i) => [i.componentId, i.quantity ?? 1]));
  const modeOf = new Map((entry.items ?? []).map((i) => [i.componentId, i.settlement?.mode ?? "invoice"]));
  const backdated = Boolean(entry.billFromMonth);
  let dueToday = 0;
  let monthly = 0;
  let yearly = 0;
  const sorted = [...comps].sort((a, b) => a.sortOrder - b.sortOrder);
  const unitOf = (c: ProposalComponent) => held.get(c.id) ?? overrideAmounts.get(c.id) ?? c.amountCents;
  const lines: ProposalLine[] = sorted.map((c) => {
    const recurring = isRecurringKind(c.kind);
    const quantity = recurring ? Math.max(1, qtyOf.get(c.id) ?? 1) : 1;
    const mode = recurring ? "invoice" : (modeOf.get(c.id) ?? "invoice");
    const waived = mode === "waive";
    const settled = mode === "offline";
    const unit = waived ? 0 : unitOf(c);
    const amt = unit * quantity;
    if (recurring) {
      const iv = resolveInterval(c);
      if (iv?.interval === "year") yearly += Math.round(amt / iv.intervalCount);
      else monthly += itemMrrCents(c, amt);
      if (!backdated) dueToday += amt; // first period, unless the catch-up replaces it
    } else if (!settled) {
      dueToday += amt;
    }
    return {
      name: c.name,
      amountCents: amt,
      unitAmountCents: unit,
      quantity,
      cadence: intervalLabel(c) || "one-time",
      oneTime: !recurring,
      settled,
      waived,
      catchUp: false,
    };
  });
  let catchUpCents = 0;
  if (entry.billFromMonth) {
    const cu = buildCatchUp({
      billFromMonth: entry.billFromMonth,
      now: opts.now,
      timeZone: opts.timeZone,
      lines: sorted
        .filter((c) => isRecurringKind(c.kind))
        .map((c) => ({
          componentId: c.id,
          name: c.name,
          kind: c.kind,
          interval: c.interval ?? null,
          intervalCount: c.intervalCount ?? 1,
          amountCents: unitOf(c),
          quantity: Math.max(1, qtyOf.get(c.id) ?? 1),
        })),
    });
    if (cu.ok) {
      for (const l of cu.backdate.lines) {
        lines.push({
          name: l.name,
          amountCents: l.cents,
          unitAmountCents: l.unitCents,
          quantity: l.quantity,
          cadence: "catch-up",
          oneTime: true,
          settled: false,
          waived: false,
          catchUp: true,
        });
      }
      catchUpCents = cu.backdate.cents;
      dueToday += catchUpCents;
    } else {
      // An unusable bill-from month (too old) falls back to a normal first period; checkout reports the error.
      for (const l of lines) if (!l.oneTime) dueToday += l.amountCents;
    }
  }
  return {
    productId: entry.productId,
    productName,
    componentIds: entryComponentIds(entry),
    domainUrl: entry.domainUrl,
    lines,
    dueTodayCents: dueToday,
    monthlyCents: monthly,
    yearlyCents: yearly,
    billFromMonth: entry.billFromMonth ?? null,
    catchUpCents,
    items: entryItemPlan(entry),
  };
}

export function combineTotals(products: ProposalProduct[]): {
  dueTodayCents: number;
  monthlyCents: number;
  yearlyCents: number;
} {
  return products.reduce(
    (acc, p) => ({
      dueTodayCents: acc.dueTodayCents + p.dueTodayCents,
      monthlyCents: acc.monthlyCents + p.monthlyCents,
      yearlyCents: acc.yearlyCents + p.yearlyCents,
    }),
    { dueTodayCents: 0, monthlyCents: 0, yearlyCents: 0 },
  );
}

/** The primary product is paid interactively — its payment saves the card
 *  used to auto-charge the rest, so prefer one with a recurring item. */
export function pickPrimaryIndex(
  entries: InviteProductEntry[],
  isRecurringComponent: (componentId: string) => boolean,
): number {
  const i = entries.findIndex((e) => entryComponentIds(e).some(isRecurringComponent));
  return i === -1 ? 0 : i;
}
