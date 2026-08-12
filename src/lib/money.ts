/**
 * Money is integer cents everywhere in the system (PRD § 2).
 * These are the only conversion points.
 */

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** Parse user/decimal input ("4500", "4,500.00", 79.5) into integer cents. */
export function toCents(input: string | number): number {
  const n =
    typeof input === "number" ? input : Number(input.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Invalid money value: ${input}`);
  const cents = Math.round(n * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Money value out of range: ${input}`);
  }
  return cents;
}
