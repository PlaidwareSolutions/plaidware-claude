import { describe, expect, it } from "vitest";
import { BILLING_SCHEDULE, nextDailyRunUtc, nextMonthlyRunUtc } from "./schedule";

describe("billing schedule", () => {
  it("daily run is later today when the hour hasn't passed, else tomorrow", () => {
    const before = new Date("2026-09-13T09:00:00Z");
    expect(nextDailyRunUtc(14, before).toISOString()).toBe("2026-09-13T14:00:00.000Z");
    const after = new Date("2026-09-13T14:00:01Z");
    expect(nextDailyRunUtc(14, after).toISOString()).toBe("2026-09-14T14:00:00.000Z");
  });

  it("monthly run rolls to next month once this month's slot has passed", () => {
    const mid = new Date("2026-09-13T12:00:00Z");
    expect(nextMonthlyRunUtc(1, 8, mid).toISOString()).toBe("2026-10-01T08:00:00.000Z");
    const early = new Date("2026-10-01T07:59:00Z");
    expect(nextMonthlyRunUtc(1, 8, early).toISOString()).toBe("2026-10-01T08:00:00.000Z");
    const dec = new Date("2026-12-20T00:00:00Z");
    expect(nextMonthlyRunUtc(1, 8, dec).toISOString()).toBe("2027-01-01T08:00:00.000Z");
  });

  it("crons and helper inputs describe the same moments", () => {
    expect(BILLING_SCHEDULE.dunningSweep.cron).toBe(`0 ${BILLING_SCHEDULE.dunningSweep.hourUtc} * * *`);
    expect(BILLING_SCHEDULE.hostingInvoices.cron).toBe(
      `0 ${BILLING_SCHEDULE.hostingInvoices.hourUtc} ${BILLING_SCHEDULE.hostingInvoices.dayOfMonth} * *`,
    );
  });
});
