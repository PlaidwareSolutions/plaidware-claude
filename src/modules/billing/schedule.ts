/**
 * Billing automation schedule — the single source of truth shared by the
 * worker (jobs.ts) and the ops Billing board, so what the page says will
 * happen next is exactly what the worker is scheduled to do.
 */
export const BILLING_SCHEDULE = {
  /** Pre-due notices + past-due reminders (3/7/14 days), then suspension. */
  dunningSweep: { queue: "billing.dunning-sweep", cron: "0 14 * * *", hourUtc: 14 },
  /** Standalone hosting-fee invoices for the previous month. */
  hostingInvoices: { queue: "billing.hosting-invoices", cron: "0 8 1 * *", dayOfMonth: 1, hourUtc: 8 },
} as const;

export { nextDailyRunUtc, nextMonthlyRunUtc } from "../../lib/schedule";
