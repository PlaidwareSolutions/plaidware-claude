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

/**
 * "2026-09-13" — the calendar day of an instant in the display zone. Sprint
 * days are the team's days, not UTC's: 7pm in Chicago is still today.
 */
export function isoDay(d: DateInput = new Date(), timeZone = DISPLAY_TZ): string {
  const x = toDate(d) ?? new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(x);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "September 2026" from a "YYYY-MM" key. */
export function formatMonth(yyyyMm: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm ?? "");
  if (!m) return EMPTY;
  const x = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return fmt({ month: "long", year: "numeric" }, "UTC").format(x);
}

/**
 * Noon UTC on a "YYYY-MM-DD" day, as ISO — a calendar day that still renders
 * as itself in any display zone (midnight UTC would show as the day before
 * in the Americas).
 */
export function fromIsoDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error("Invalid day");
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toISOString();
}

/** "2026-09" — the calendar month of an instant in the display zone. */
export function monthKey(d: DateInput = new Date(), timeZone = DISPLAY_TZ): string {
  return isoDay(d, timeZone).slice(0, 7);
}

function tzOffsetMs(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant of local midnight on the 1st of a month in the given zone (DST-safe). */
function zonedMonthStart(y: number, mo: number, timeZone: string): Date {
  const naive = Date.UTC(y, mo - 1, 1);
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/**
 * Bounds of a "YYYY-MM" month in the display zone: `start` is local midnight
 * on the 1st, `end` the same for the following month (exclusive).
 */
export function monthBounds(yyyyMm: string, timeZone = DISPLAY_TZ): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  const mo = m ? Number(m[2]) : 0;
  if (!m || mo < 1 || mo > 12) throw new Error("Invalid month");
  const y = Number(m[1]);
  return {
    start: zonedMonthStart(y, mo, timeZone),
    end: zonedMonthStart(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, timeZone),
  };
}

/** Inclusive "YYYY-MM" keys from one month through another; empty when `from` is later. */
export function monthKeysBetween(from: string, to: string): string[] {
  const idx = (k: string) => {
    const m = /^(\d{4})-(\d{2})$/.exec(k);
    if (!m) throw new Error("Invalid month");
    return Number(m[1]) * 12 + Number(m[2]) - 1;
  };
  const a = idx(from);
  const b = idx(to);
  const out: string[] = [];
  for (let i = a; i <= b; i++) out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  return out;
}
