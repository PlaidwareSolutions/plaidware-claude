/**
 * The only date formatting in the app. Everything renders in one fixed
 * display time zone so server (Railway/UTC) and client output the same
 * string — no hydration mismatches, no "which TZ is this?" per page.
 * Set NEXT_PUBLIC_DISPLAY_TZ (e.g. America/Chicago) in the deploy env.
 */
export const DISPLAY_TZ = process.env.NEXT_PUBLIC_DISPLAY_TZ ?? "UTC";

export type DateInput = Date | string | number | null | undefined;

const LOCALE = "en-US";
const EMPTY = "—";

function toDate(d: DateInput): Date | null {
  if (d == null || d === "") return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

function fmt(opts: Intl.DateTimeFormatOptions, timeZone = DISPLAY_TZ) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, ...opts });
}

/** "Sep 13, 2026" */
export function formatDate(d: DateInput): string {
  const x = toDate(d);
  return x ? fmt({ month: "short", day: "numeric", year: "numeric" }).format(x) : EMPTY;
}

/** "Sep 13, 2026, 14:05" (24h) */
export function formatDateTime(d: DateInput): string {
  const x = toDate(d);
  return x
    ? fmt({ month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(x)
    : EMPTY;
}

/** "Sep 13" — for dense tables and timelines. */
export function formatDay(d: DateInput): string {
  const x = toDate(d);
  return x ? fmt({ month: "short", day: "numeric" }).format(x) : EMPTY;
}

/** "Sep 13 · 14:00 UTC" — always UTC; for scheduled jobs whose crons are UTC. */
export function formatUtcHour(d: DateInput): string {
  const x = toDate(d);
  if (!x) return EMPTY;
  const hh = String(x.getUTCHours()).padStart(2, "0");
  const mm = String(x.getUTCMinutes()).padStart(2, "0");
  return `${fmt({ month: "short", day: "numeric" }, "UTC").format(x)} · ${hh}:${mm} UTC`;
}

/** "3 hours ago" / "in 2 days" / "yesterday" / "just now". */
export function formatRelative(d: DateInput, now: DateInput = new Date()): string {
  const x = toDate(d);
  if (!x) return EMPTY;
  const n = toDate(now) ?? new Date();
  const diff = x.getTime() - n.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

/** "September 2026" from a "YYYY-MM" key. */
export function formatMonth(yyyyMm: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm ?? "");
  if (!m) return EMPTY;
  const x = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return fmt({ month: "long", year: "numeric" }, "UTC").format(x);
}
