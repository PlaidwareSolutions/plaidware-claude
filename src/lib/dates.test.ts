import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDay, formatMonth, formatRelative, formatUtcHour, isoDay } from "./dates";

// Tests run without NEXT_PUBLIC_DISPLAY_TZ → display zone is UTC.
const T = new Date("2026-09-13T14:05:30Z");

describe("dates", () => {
  it("formats absolute dates in the display zone", () => {
    expect(formatDate(T)).toBe("Sep 13, 2026");
    expect(formatDateTime(T)).toBe("Sep 13, 2026, 14:05");
    expect(formatDay(T)).toBe("Sep 13");
    expect(formatDate(T.toISOString())).toBe("Sep 13, 2026");
  });

  it("renders a dash for nothing / garbage", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDay("not a date")).toBe("—");
    expect(formatMonth("2026")).toBe("—");
  });

  it("gives the calendar day in the display zone", () => {
    expect(isoDay("2026-09-13T23:30:00Z", "America/Chicago")).toBe("2026-09-13");
    expect(isoDay("2026-09-14T03:00:00Z", "America/Chicago")).toBe("2026-09-13");
    expect(isoDay("2026-09-14T03:00:00Z", "UTC")).toBe("2026-09-14");
    expect(isoDay(T)).toBe("2026-09-13");
  });

  it("formats UTC job times regardless of display zone", () => {
    expect(formatUtcHour("2026-10-01T08:00:00Z")).toBe("Oct 1 · 08:00 UTC");
  });

  it("formats relative time", () => {
    const now = new Date("2026-09-13T17:05:30Z");
    expect(formatRelative(T, now)).toBe("3 hours ago");
    expect(formatRelative("2026-09-15T17:05:30Z", now)).toBe("in 2 days");
    expect(formatRelative("2026-09-13T17:05:00Z", now)).toBe("just now");
  });

  it("formats month keys", () => {
    expect(formatMonth("2026-09")).toBe("September 2026");
  });
});
