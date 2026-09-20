/**
 * Order keys for cards within a column: lowercase strings over a–z, compared
 * lexicographically (byte order == alphabetical for this alphabet under any
 * collation). A key is a base-26 fraction ("n" = 13/26 = 0.5); keys never end
 * in "a" (0) so every value has one spelling and strict ordering holds.
 *
 * Strings beat doubles here: ~50 midpoint insertions between the same two
 * doubles exhaust the mantissa and silently produce equal keys, while a string
 * midpoint only grows by one character per repeated insertion in the same gap
 * — and the length itself tells the service when to rebalance a column.
 */
export const RANK_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const BASE = RANK_ALPHABET.length;
/** A rank this long means one gap has been split many times: rebalance the column. */
export const RANK_REBALANCE_AT = 32;

const digits = (s: string): number[] => [...s].map((c) => RANK_ALPHABET.indexOf(c));
const encode = (d: number[]): string => d.map((n) => RANK_ALPHABET[n]).join("");

export function isValidRank(s: string): boolean {
  return /^[a-z]+$/.test(s) && !s.endsWith("a");
}

/**
 * A key strictly between `prev` and `next` (either may be null for an open
 * end). rankBetween(null, null) is the first key on an empty column.
 */
export function rankBetween(prev: string | null, next: string | null): string {
  if (prev !== null && next !== null && prev >= next) {
    throw new Error(`rankBetween: prev "${prev}" must sort before next "${next}"`);
  }
  const a = prev ? digits(prev) : [];
  // An open upper end is the fraction 1.0: a single out-of-range digit.
  const b = next ? digits(next) : [BASE];
  const out: number[] = [];
  let i = 0;
  // Copy the common prefix (a is padded with zeros; b is canonical so it ends first only when b > a).
  while ((a[i] ?? 0) === (b[i] ?? 0)) {
    out.push(a[i] ?? 0);
    i++;
  }
  const da = a[i] ?? 0;
  const db = b[i] ?? 0;
  if (db - da >= 2) {
    out.push(Math.floor((da + db) / 2));
    return encode(out);
  }
  // Adjacent digits: keep a's digit and find room after a's remainder, below 1.0.
  out.push(da);
  i++;
  for (;;) {
    const x = a[i] ?? 0;
    if (x < BASE - 1) {
      out.push(Math.floor((x + BASE) / 2));
      return encode(out);
    }
    out.push(BASE - 1);
    i++;
  }
}

/** `count` evenly spaced keys, strictly increasing, as short as the spacing allows. */
export function rebalanceRanks(count: number): string[] {
  if (count <= 0) return [];
  let len = 1;
  while (BASE ** len <= 2 * (count + 1)) len++;
  const span = BASE ** len;
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    let v = Math.floor((i * span) / (count + 1));
    const d: number[] = [];
    for (let k = 0; k < len; k++) {
      d.unshift(v % BASE);
      v = Math.floor(v / BASE);
    }
    while (d.length > 1 && d[d.length - 1] === 0) d.pop();
    keys.push(encode(d));
  }
  return keys;
}

export function compareRanks(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
