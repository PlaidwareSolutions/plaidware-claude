import {
  intervalLabel,
  isRecurringKind,
  itemMrrCents,
  resolveInterval,
} from "../billing/mappers";

/** One product's locked configuration inside a setup invite. */
export type InviteProductEntry = {
  productId: string;
  componentIds: string[];
  domainUrl: string | null;
};

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

/** Price one product's selection: overrides applied, first-period totals. */
export function buildProductProposal(
  entry: InviteProductEntry,
  productName: string,
  comps: ProposalComponent[],
  overrideAmounts: Map<string, number>,
): ProposalProduct {
  let dueToday = 0;
  let monthly = 0;
  let yearly = 0;
  const lines = [...comps]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const amt = overrideAmounts.get(c.id) ?? c.amountCents;
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
    componentIds: entry.componentIds,
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
  const i = entries.findIndex((e) => e.componentIds.some(isRecurringComponent));
  return i === -1 ? 0 : i;
}
