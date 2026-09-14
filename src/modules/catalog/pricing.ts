import { intervalLabel, isRecurringKind, itemMrrCents } from "../billing/mappers";

type PriceComponent = {
  kind: string;
  role?: string;
  interval?: string | null;
  intervalCount?: number | null;
  amountCents: number;
  isActive?: boolean;
};

/**
 * Catalog pricing in one place — every "from $X/mo" on the marketing site,
 * the products board, and the trial email derive from these, so a legacy
 * component kind (`recurring_monthly`) can never make a price vanish.
 */

/** "/mo", "/yr", "/3 mo", or "one-time". */
export function cadenceLabel(c: PriceComponent): string {
  return isRecurringKind(c.kind) ? intervalLabel(c) || "/mo" : "one-time";
}

/** Monthly-equivalent recurring total of the product's active components. */
export function monthlyFromCents(components: PriceComponent[]): number {
  return components
    .filter((c) => c.isActive !== false && isRecurringKind(c.kind))
    .reduce((sum, c) => sum + itemMrrCents(c, c.amountCents), 0);
}

/** The base charge (or the first component) as "$79.00/mo" / "$4,500.00 one-time". */
export function baseChargeLabel(
  components: PriceComponent[],
  fmt: (cents: number) => string,
): string | null {
  const active = components.filter((c) => c.isActive !== false);
  const base = active.find((c) => c.role === "base") ?? active[0];
  if (!base) return null;
  const cadence = cadenceLabel(base);
  return `${fmt(base.amountCents)}${cadence === "one-time" ? " one-time" : cadence}`;
}
