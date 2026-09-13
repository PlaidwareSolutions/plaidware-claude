/**
 * Billing automation schedule — the single source of truth shared by the
 * worker (jobs.ts) and the ops Billing board, so what the page says will
 * happen next is exactly what the worker is scheduled to do.
 */
export const BILLING_SCHEDULE = {
  /** Pre-due notices + past-due reminders (3/7/14 days), then suspension. */
  dunningSweep: { cron: "0 14 * * *", hourUtc: 14 },
  /** Standalone hosting-fee invoices for the previous month. */
  hostingInvoices: { cron: "0 8 1 * *", dayOfMonth: 1, hourUtc: 8 },
} as const;

export function nextDailyRunUtc(hourUtc: number, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function nextMonthlyRunUtc(dayOfMonth: number, hourUtc: number, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth, hourUtc));
  if (d <= now) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
