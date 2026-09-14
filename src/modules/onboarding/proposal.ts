import {
  intervalLabel,
  isRecurringKind,
  itemMrrCents,
  resolveInterval,
} from "../billing/mappers";

/**
 * One product's locked configuration inside a setup invite. Prices live on
 * the invite (`items[].priceCents`, null = list) and only become tenant
 * overrides when the client commits — so a link that is never used leaves
 * nothing behind. Legacy rows carry `componentIds` only.
 */
export type InviteProductEntry = {
  productId: string;
  items?: { componentId: string; priceCents: number | null }[];
  /** Legacy shape (pre invite-held pricing); read-compat only. */
  componentIds?: string[];
  domainUrl: string | null;
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

export type ProposalLine = {
  name: string;
  amountCents: number;
  cadence: string;
  oneTime: boolean;
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
 * tenant override passed in, then list. First-period totals.
 */
export function buildProductProposal(
  entry: InviteProductEntry,
  productName: string,
  comps: ProposalComponent[],
  overrideAmounts: Map<string, number>,
): ProposalProduct {
  const held = entryPriceMap(entry);
  let dueToday = 0;
  let monthly = 0;
  let yearly = 0;
  const lines = [...comps]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const amt = held.get(c.id) ?? overrideAmounts.get(c.id) ?? c.amountCents;
      dueToday += amt; // one-time + first period of each recurring item
      if (isRecurringKind(c.kind)) {
        const iv = resolveInterval(c);
        if (iv?.interval === "year") yearly += Math.round(amt / iv.intervalCount);
        else monthly += itemMrrCents(c, amt);
      }
      return {
        name: c.name,
        amountCents: amt,
        cadence: intervalLabel(c) || "one-time",
        oneTime: !isRecurringKind(c.kind),
      };
    });
  return {
    productId: entry.productId,
    productName,
    componentIds: entryComponentIds(entry),
    domainUrl: entry.domainUrl,
    lines,
    dueTodayCents: dueToday,
    monthlyCents: monthly,
    yearlyCents: yearly,
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
