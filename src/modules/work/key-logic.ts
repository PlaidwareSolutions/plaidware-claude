/** Item keys: a per-board prefix plus the item's number, e.g. "BLD-42". */

const FALLBACK = "WRK";
const MAX_LEN = 4;

/** Initials of a multi-word slug ("company-website" → "CW"), else the first letters of the word. */
export function defaultKeyPrefix(slug: string): string {
  const words = slug.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const p =
    words.length >= 2
      ? words.map((w) => w[0]).join("").slice(0, MAX_LEN)
      : words.length === 1
        ? words[0].slice(0, MAX_LEN)
        : "";
  return p.length >= 2 ? p.toUpperCase() : FALLBACK;
}

/** `base`, or base2, base3… until one isn't taken. */
export function uniqueKeyPrefix(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function formatKey(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

export function parseKey(s: string): { prefix: string; number: number } | null {
  const m = /^([A-Za-z][A-Za-z0-9]{1,5})-(\d+)$/.exec(s.trim());
  if (!m) return null;
  const number = Number(m[2]);
  return number >= 1 ? { prefix: m[1].toUpperCase(), number } : null;
}
