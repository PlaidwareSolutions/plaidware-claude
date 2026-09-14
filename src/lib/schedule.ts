/**
 * "When does it run next" for the worker's fixed schedules — shared by every
 * module's schedule.ts and the boards that promise a next run.
 */
export function nextDailyRunUtc(hourUtc: number, now = new Date(), minuteUtc = 0): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, minuteUtc));
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function nextMonthlyRunUtc(dayOfMonth: number, hourUtc: number, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth, hourUtc));
  if (d <= now) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Next boundary of an every-N-minutes cron ("star-slash-N" schedules). */
export function nextIntervalRunUtc(everyMinutes: number, now = new Date()): Date {
  const ms = everyMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms + ms);
}
